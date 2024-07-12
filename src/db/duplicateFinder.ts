import { cleanCreator, cleanDOI, cleanISBN, normalizeString, unique } from "../utils/utils";

export class DuplicateFinder {
  private readonly item: Zotero.Item;
  private readonly itemTypeID: number;
  private candidateItemIDs: number[];

  constructor(item: Zotero.Item | number) {
    this.item = typeof item === "number" ? Zotero.Items.get(item) : item;
    this.candidateItemIDs = [];
    this.itemTypeID = this.item.itemTypeID;
  }

  async find() {
    ztoolkit.log("Finding duplicates for item", this.item.id, this.item.getDisplayTitle());
    await this.findByDcReplacesRelation();
    ztoolkit.log("Finding duplicates Candidates after dc:replaces", this.candidateItemIDs);
    await this.findByDOI();
    ztoolkit.log("Finding duplicates Candidates after DOI", this.candidateItemIDs);
    await this.findBookByISBN();
    ztoolkit.log("Finding duplicates Candidates after ISBN", this.candidateItemIDs);
    await this.findByTitle();
    ztoolkit.log("Finding duplicates Candidates after Title", this.candidateItemIDs);
    await this.findByCreators();
    ztoolkit.log("Finding duplicates Candidates after Creators", this.candidateItemIDs);
    await this.findByYear();
    ztoolkit.log("Finding duplicates Candidates after Year", this.candidateItemIDs);
    return this.candidateItemIDs;
  }

  public static async findByRelations(item: Zotero.Item, predicate: _ZoteroTypes.RelationsPredicate, asIDs = true) {
    let queue: Zotero.Item[] = [item];
    let candidates = [];
    let processedURIs = new Set<string>();

    while (queue.length > 0) {
      const currentItem = queue.shift();
      if (!currentItem) {
        continue;
      }

      const currentURI = Zotero.URI.getItemURI(currentItem);
      if (processedURIs.has(currentURI)) {
        continue;
      }

      const prevVersionItems: Zotero.Item[] = await Zotero.Relations.getByPredicateAndObject(
        "item",
        predicate,
        currentURI,
      );
      // If there are no previous versions, then this is a candidate
      if (prevVersionItems.length === 0 && !currentItem.deleted) {
        ztoolkit.log("Found candidate", currentItem.id, currentItem.getDisplayTitle());
        candidates.push(asIDs ? currentItem.id : currentItem);
      }
      // Otherwise, add the previous versions to the queue
      for (const prevItem of prevVersionItems) {
        const uri = Zotero.URI.getItemURI(prevItem);
        if (!processedURIs.has(uri)) {
          queue.push(prevItem);
        }
      }
      processedURIs.add(currentURI);
    }

    return candidates;
  }

  private async findByDcReplacesRelation() {
    const predicate = Zotero.Relations.replacedItemPredicate;
    this.candidateItemIDs = (await DuplicateFinder.findByRelations(this.item, predicate, true)) as number[];
    return this;
  }

  private async findByDOI() {
    if (this.candidateItemIDs.length === 1) {
      return this;
    }

    const dois = cleanDOI(this.item);
    if (dois.length === 0) {
      return this;
    }
    const candidateAndClause = buildCandidateAndClause(this.candidateItemIDs);
    // Match by DOI
    // NOTE: according to `likeSqlRegex = /\bLIKE\b\s(?![@:?])/i;` (at Sqlite.sys.mjs#L26)
    // `LIKE` can be followed by `@`, `:`, or `?`
    const partialWhereClause = dois.map(() => "TRIM(UPPER(value)) LIKE ?").join(" OR ");
    const fieldIDs = [Zotero.ItemFields.getID("DOI"), Zotero.ItemFields.getID("url"), Zotero.ItemFields.getID("extra")];
    const fieldIDInClause = fieldIDs.map(() => "?").join(", ");
    const query = `SELECT DISTINCT itemID
                   FROM itemDataValues
                            JOIN itemData USING (valueID)
                            JOIN items USING (itemID)
                            LEFT JOIN deletedItems USING (itemID)
                   WHERE deletedItems.itemID IS NULL
                     AND libraryID = ?
                     AND itemTypeID = ?
                     AND fieldID IN (${fieldIDInClause})
                     AND (${partialWhereClause}) ${candidateAndClause};`;
    const doiParams = dois.map((doi) => `%${doi}%`);
    const params = [this.item.libraryID, this.itemTypeID, ...fieldIDs, ...doiParams, ...this.candidateItemIDs];
    const rows: { itemID: number }[] = await Zotero.DB.queryAsync(query, params);
    this.candidateItemIDs = rows.map((row) => row.itemID);
    return this;
  }

  private async findBookByISBN() {
    if (this.candidateItemIDs.length === 1) {
      return this;
    }

    if (this.itemTypeID !== Zotero.ItemTypes.getID("book")) {
      return this;
    }
    const isbns = cleanISBN(this.item);
    if (isbns.length === 0) {
      return this;
    }
    const candidateAndClause = buildCandidateAndClause(this.candidateItemIDs);
    const partialWhereClause = isbns.map(() => "REPLACE(value, '-', '') LIKE ?").join(" OR ");
    const fieldIDs: number[] = ["DOI", "ISBN", "url", "extra"].map(Zotero.ItemFields.getID);
    const fieldIDInClause = fieldIDs.map(() => "?").join(", ");
    // Match by ISBN
    const query = `SELECT DISTINCT itemID
                   FROM itemDataValues
                            JOIN itemData USING (valueID)
                            JOIN items USING (itemID)
                            LEFT JOIN deletedItems USING (itemID)
                   WHERE deletedItems.itemID IS NULL
                     AND libraryID = ?
                     AND itemTypeID = ?
                     AND fieldID IN (${fieldIDInClause})
                     AND (${partialWhereClause}) ${candidateAndClause};`;
    const isbnPragmas = isbns.map((isbn) => `%${isbn}%`);
    const params = [this.item.libraryID, this.itemTypeID, ...fieldIDs, ...isbnPragmas, ...this.candidateItemIDs];
    const rows: { itemID: number }[] = await Zotero.DB.queryAsync(query, params);
    this.candidateItemIDs = rows.map((row) => row.itemID);
    return this;
  }

  private async findByTitle() {
    if (this.candidateItemIDs.length === 1) {
      return this;
    }
    const titles = unique([
      normalizeString(this.item.getDisplayTitle()),
      normalizeString(this.item.getField("title")),
    ]).filter((title) => title.length > 0);
    if (titles.length === 0) {
      // Should not happen
      return this;
    }
    const titleIDs = Zotero.ItemFields.getTypeFieldsFromBase("title");
    titleIDs.push(Zotero.ItemFields.getID("title"));

    const candidateAndClause = buildCandidateAndClause(this.candidateItemIDs);
    const partialWhereClause = titles.map(() => "TRIM(UPPER(value)) LIKE ?").join(" OR ");
    const query = `SELECT DISTINCT itemID
                   FROM itemDataValues
                            JOIN itemData USING (valueID)
                            JOIN items USING (itemID)
                            LEFT JOIN deletedItems USING (itemID)
                   WHERE deletedItems.itemID IS NULL
                     AND libraryID = ?
                     AND itemTypeID = ?
                     AND fieldID IN (${titleIDs.map(() => "?").join(", ")})
                     AND (${partialWhereClause}) ${candidateAndClause};`;
    const params = [this.item.libraryID, this.itemTypeID, ...titleIDs, ...titles, ...this.candidateItemIDs];
    const rows: { itemID: number }[] = await Zotero.DB.queryAsync(query, params);
    this.candidateItemIDs = rows.map((row) => row.itemID);
    return this;
  }

  private async findByCreators() {
    if (this.candidateItemIDs.length <= 1) {
      // NOTE: DON'T use this function without candidates
      return this;
    }
    const primaryCreatorTypeID = Zotero.CreatorTypes.getPrimaryIDForType(this.item.itemTypeID);
    if (!primaryCreatorTypeID) {
      // We only check the primary creator type
      return this;
    }
    const creators = this.item
      .getCreators()
      .filter((creator) => creator.creatorTypeID === primaryCreatorTypeID)
      .map((creator) => cleanCreator(creator));
    if (creators.length === 0) {
      return this;
    }
    const candidateAndClause = buildCandidateAndClause(this.candidateItemIDs);
    const partialWhereClause = creators
      .map(() => "TRIM(UPPER(firstName)) LIKE ? AND TRIM(UPPER(lastName)) LIKE ?")
      .join(" OR ");
    const query = `SELECT DISTINCT itemID
                   FROM itemCreators
                            JOIN creators USING (creatorID)
                            LEFT JOIN deletedItems USING (itemID)
                   WHERE creatorTypeID = ?
                     AND deletedItems.itemID IS NULL
                     AND (${partialWhereClause}) ${candidateAndClause}
                   GROUP BY itemID
                   HAVING COUNT(itemID) > 0;`; // NOTE: Only if ONE creator matches
    // HAVING COUNT(itemID) = ${creators.length};`; // NOTE: All creators must match
    const params = [
      primaryCreatorTypeID,
      ...creators.flatMap((creator) => Object.values(creator)),
      ...this.candidateItemIDs,
    ];
    const rows: { itemID: number }[] = await Zotero.DB.queryAsync(query, params);
    this.candidateItemIDs = rows.map((row) => row.itemID);
    return this;
  }

  private async findByYear(threshold = 1) {
    if (this.candidateItemIDs.length <= 1) {
      // NOTE: DON'T use this function without candidates
      return this;
    }
    const year = Number(this.item.getField("year"));
    if (!year) {
      return this;
    }
    const minYear = year - threshold;
    const maxYear = year + threshold;
    const candidateAndClause = buildCandidateAndClause(this.candidateItemIDs);
    const dateFields = Zotero.ItemFields.getTypeFieldsFromBase("date");
    dateFields.push(Zotero.ItemFields.getID("date"));

    const query = `SELECT DISTINCT itemID
                   FROM itemDataValues
                            JOIN itemData USING (valueID)
                            JOIN items USING (itemID)
                            LEFT JOIN deletedItems USING (itemID)
                   WHERE deletedItems.itemID IS NULL
                     AND libraryID = ?
                     AND itemTypeID = ?
                     AND fieldID IN (${dateFields.map(() => "?").join(", ")})
                     AND SUBSTR(value, 1, 4) >= '?'
                     AND SUBSTR(value, 1, 4) <= '?'
                       ${candidateAndClause};`;
    const params = [this.item.libraryID, this.itemTypeID, ...dateFields, minYear, maxYear, ...this.candidateItemIDs];
    const rows: { itemID: number }[] = await Zotero.DB.queryAsync(query, params);
    this.candidateItemIDs = rows.map((row) => row.itemID);
    return this;
  }
}

function buildCandidateAndClause(candidateItemIDs: number[]) {
  let candidateAndClause = "";
  if (candidateItemIDs.length > 0) {
    candidateAndClause = candidateItemIDs.map(() => "?").join(", ");
    candidateAndClause = `AND itemID IN (${candidateAndClause})`;
  }
  return candidateAndClause;
}

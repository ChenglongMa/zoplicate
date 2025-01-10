declare namespace Zotero {
  namespace Relations {
    const relatedItemPredicate: _ZoteroTypes.RelationsPredicate;
    const linkedObjectPredicate: _ZoteroTypes.RelationsPredicate;
    const replacedItemPredicate: _ZoteroTypes.RelationsPredicate;

    function init(): Promise<void>;

    function register(objectType: string, subjectID: string, predicate: string, object: string): void;
    function unregister(objectType: string, subjectID: string, predicate: string, object: string): void;

    function getByPredicateAndObject(objectType: string, predicate: string, object: string): Promise<Zotero.Item[]>;
    function getByObject(objectType: string, object: string): Promise<{ subject: Zotero.DataObject; predicate: string }[]>;

    function copyObjectSubjectRelations(fromObject: Zotero.DataObject, toObject: Zotero.DataObject): Promise<void>;
    function updateUser(fromUserID: string, toUserID: string): Promise<void>;
    function purge(): Promise<void>;
  }

  namespace RelationPredicates {
    function getID(predicate: string): number;
    function getName(predicateID: number): string;
  }
}

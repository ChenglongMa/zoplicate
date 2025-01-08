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
  // static class Relations {
  //   static readonly relatedItemPredicate: _ZoteroTypes.RelationsPredicate;
  //   static readonly linkedObjectPredicate: _ZoteroTypes.RelationsPredicate;
  //   static readonly replacedItemPredicate: _ZoteroTypes.RelationsPredicate;
  //
  //   private static _namespaces: { [key: string]: string };
  //   private static _types: string[];
  //   private static _subjectsByPredicateIDAndObject: { [key: string]: any };
  //   private static _subjectPredicatesByObject: { [key: string]: any };
  //
  //   static init(): Promise<void>;
  //
  //   static register(objectType: string, subjectID: string, predicate: string, object: string): void;
  //   static unregister(objectType: string, subjectID: string, predicate: string, object: string): void;
  //
  //   static getByPredicateAndObject(objectType: string, predicate: string, object: string): Promise<Zotero.Item[]>;
  //   static getByObject(objectType: string, object: string): Promise<{ subject: Zotero.DataObject; predicate: string }[]>;
  //
  //   static copyObjectSubjectRelations(fromObject: Zotero.DataObject, toObject: Zotero.DataObject): Promise<void>;
  //   static updateUser(fromUserID: string, toUserID: string): Promise<void>;
  //   static purge(): Promise<void>;
  //
  //   private static _getPrefixAndValue(uri: string): [string, string];
  // }

  namespace RelationPredicates {
    function getID(predicate: string): number;
    function getName(predicateID: number): string;
  }
}

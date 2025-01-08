declare namespace Zotero {
  namespace ItemFields {
    function getName(field: number | string): string | false;
    function getID(field: number | string): number | false;
    function isValidForType(fieldID: number | string, itemTypeID: number): boolean;
    function isInteger(fieldID: number | string): boolean;
    function getItemTypeFields(itemTypeID: number): number[];
    function isBaseField(field: number | string): boolean;
    function isFieldOfBase(field: number | string, baseField: number | string): boolean;
    function getFieldIDFromTypeAndBase(itemType: number | string, baseField: number | string): number | false;
    function getBaseIDFromTypeAndField(itemType: number | string, typeField: number | string): number | false;
    function getTypeFieldsFromBase(baseField: number | string, asNames?: boolean): number[] | string[] | false;
    function isAutocompleteField(field: number | string): boolean;
    function isMultiline(field: number | string): boolean;
    function getDirection(itemTypeID: number, field: number | string, itemLanguage?: string): 'auto' | 'ltr' | 'rtl';
    function getAll(): { id: number, name: string }[];
    function getLocalizedString(field: number | string): string;
    function isCustom(fieldID: number | string): boolean;
    function isDate(field: number | string): boolean;
    function isLong(): boolean;
    function init(): Promise<void>;
    function getBaseMappedFields(): number[];
  }
}

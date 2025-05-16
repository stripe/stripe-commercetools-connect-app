import {
  CustomFields,
  Type,
  TypeAddFieldDefinitionAction,
  TypeDraft,
  TypeRemoveFieldDefinitionAction,
} from '@commercetools/platform-sdk/dist/declarations/src/generated/models/type';
import {
  CustomerSetCustomFieldAction,
  CustomerSetCustomTypeAction,
} from '@commercetools/platform-sdk/dist/declarations/src/generated/models/customer';
import { log } from '../../libs/logger';
import {
  createCustomType,
  deleteCustomTypeByKey,
  getTypesByResourceTypeId,
  updateCustomTypeByKey,
} from './customTypeClient';

export interface KeyAndVersion {
  key: string;
  version: number;
}

export function hasField(type: Type | TypeDraft, fieldName: string): boolean {
  return !!type.fieldDefinitions?.some((field) => field.name === fieldName);
}

export function hasAllFields(customType: Type | TypeDraft, type: Type | TypeDraft) {
  return customType.fieldDefinitions?.every(({ name }) => hasField(type, name));
}

export function findValidCustomType(allTypes: (Type | TypeDraft)[], customType: Type | TypeDraft) {
  if (customType.fieldDefinitions?.length === 0) {
    return undefined;
  }

  for (const type of allTypes) {
    const match = hasAllFields(customType, type);
    if (match) {
      return type;
    }
  }
  return undefined;
}

export async function addOrUpdateCustomType(customType: TypeDraft): Promise<void> {
  const resourceTypeId = customType.resourceTypeIds[0];
  const types = await getTypesByResourceTypeId(resourceTypeId);

  if (!types.length) {
    await createCustomType(customType);
    log.info(`Custom Type "${customType.key}" created successfully.`);
    return;
  }

  log.info(`Custom Type with resourceTypeId "${resourceTypeId}" already exists. Skipping creation.`);
  for (const type of types) {
    const { key, version } = type;
    const fieldUpdates: TypeAddFieldDefinitionAction[] = (customType.fieldDefinitions ?? [])
      .filter(({ name }) => !hasField(type, name))
      .map((fieldDefinition) => ({
        action: 'addFieldDefinition',
        fieldDefinition,
      }));

    if (!fieldUpdates.length) {
      log.info(`Custom Type "${key}" already contains all required fields. Skipping update.`);
      continue;
    }

    await updateCustomTypeByKey({ key, version, actions: fieldUpdates });
    log.info(`Custom Type "${key}" updated successfully with new fields.`);
  }
}

export async function deleteOrUpdateCustomType(customType: TypeDraft): Promise<void> {
  const resourceTypeId = customType.resourceTypeIds[0];
  const types = await getTypesByResourceTypeId(resourceTypeId);

  if (!types.length) {
    log.info(`Custom Type with resourceTypeId "${resourceTypeId}" does not exist. Skipping deletion.`);
    return;
  }

  for (const type of types) {
    const { key, version } = type;
    const fieldUpdates: TypeRemoveFieldDefinitionAction[] = (customType.fieldDefinitions ?? [])
      .filter(({ name }) => hasField(type, name))
      .map(({ name }) => ({
        action: 'removeFieldDefinition',
        fieldName: name,
      }));

    if (!fieldUpdates.length) {
      log.info(`Custom Type "${key}" has no matching fields to remove. Skipping deletion.`);
      continue;
    }

    const hasSameFields = fieldUpdates.length === type.fieldDefinitions?.length;
    if (!hasSameFields) {
      await updateCustomTypeByKey({ key, version, actions: fieldUpdates });
      log.info(`Removed ${fieldUpdates.length} fields(s) from Custom Type "${key}" successfully.`);
      continue;
    }

    try {
      await deleteCustomTypeByKey({ key, version });
      log.info(`Custom Type "${key}" deleted successfully.`);
    } catch (error) {
      const referencedMessage = 'Can not delete a type while it is referenced';
      if (error instanceof Error && error.message.includes(referencedMessage)) {
        log.warn(`Custom Type "${key}" is referenced by at least one customer. Skipping deletion.`);
      } else {
        throw error;
      }
    }
  }
}

/**
 * This function is used to get the actions for setting a custom field in a customer.
 * If the custom type exists and all fields exist, it returns `setCustomField` actions,
 * if not, it returns `setCustomType` action.
 * @returns An array of actions to update the custom field in the customer.
 **/
export async function getCustomFieldUpdateActions({
  customFields,
  fields,
  customType,
}: {
  customFields?: CustomFields;
  fields: Record<string, string>;
  customType: TypeDraft;
}): Promise<(CustomerSetCustomTypeAction | CustomerSetCustomFieldAction)[]> {
  const resourceTypeId = customType.resourceTypeIds[0];
  const allTypes = await getTypesByResourceTypeId(resourceTypeId);
  if (!allTypes.length) {
    throw new Error(`Custom Type not found for resource "${resourceTypeId.toUpperCase()}"`);
  }

  const typeAssigned = allTypes.find(({ id }) => id === customFields?.type.id);
  const allFieldsExist = !!(typeAssigned && hasAllFields(customType, typeAssigned));

  if (customFields?.type.id && allFieldsExist) {
    return Object.entries(fields).map(([name, value]) => ({
      action: 'setCustomField',
      name,
      value,
    }));
  }

  const newType = allTypes.find(({ key }) => key === customType.key) ?? findValidCustomType(allTypes, customType);
  if (!newType) {
    throw new Error(`A valid Custom Type was not found for resource "${resourceTypeId.toUpperCase()}"`);
  }

  return [
    {
      action: 'setCustomType',
      type: { key: newType.key, typeId: 'type' },
      fields,
    },
  ];
}

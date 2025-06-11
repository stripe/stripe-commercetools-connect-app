import {
  CustomFields,
  Type,
  TypeAddFieldDefinitionAction,
  TypeDraft,
  TypeRemoveFieldDefinitionAction,
} from '@commercetools/platform-sdk';
import { log } from '../../libs/logger';
import {
  createCustomType,
  deleteCustomTypeByKey,
  getTypesByResourceTypeId,
  updateCustomTypeByKey,
} from './custom-type-client';

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

  // Check if the specific custom type (by key) already exists
  const existingType = types.find((type) => type.key === customType.key);

  if (!existingType) {
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
    const fieldsToRemove = (customType.fieldDefinitions ?? [])
      .filter(({ name }) => hasField(type, name))
      .map(({ name }) => name);

    if (!fieldsToRemove.length) {
      log.info(`Custom Type "${key}" has no matching fields to remove. Skipping deletion.`);
      continue;
    }

    const hasAdditionalFields = type.fieldDefinitions?.some((field) => !fieldsToRemove.includes(field.name));

    if (hasAdditionalFields) {
      const fieldUpdates: TypeRemoveFieldDefinitionAction[] = fieldsToRemove.map((name) => ({
        action: 'removeFieldDefinition',
        fieldName: name,
      }));

      await updateCustomTypeByKey({ key, version, actions: fieldUpdates });
      log.info(
        `Removed ${fieldsToRemove.length} field(s) from Custom Type "${key}", but kept the type as it contains additional fields.`,
      );
    } else {
      try {
        await deleteCustomTypeByKey({ key, version });
        log.info(`Custom Type "${key}" deleted successfully as it contained only our fields.`);
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
}

/**
 * This function is used to get the actions for setting a custom field in a resource.
 * If the custom type exists and all fields exist, it returns `setCustomField` actions,
 * if not, it returns `setCustomType` action.
 * You must provide the generic type of the resource actions it should return.
 * @param fields - The fields to set in the custom type.
 * @param customType - The custom type to set.
 * @param customFields - The existing custom fields in the resource.
 * @param idValue - The ID or Key of the resource to update, only if required.
 * @param prefix - The prefix to use for the action (e.g., 'LineItem'), defaults to `setCustomField` or `setCustomType`.
 * @returns An array of actions to update the custom field in the customer.
 **/
export async function getCustomFieldUpdateActions<T extends object>({
  fields,
  customType,
  customFields,
  idValue,
  prefix,
}: {
  fields: Record<string, string>;
  customType: TypeDraft;
  customFields?: CustomFields;
  idValue?: Partial<T>;
  prefix?: 'LineItem' | string;
}): Promise<T[]> {
  const actionPrefix = prefix ?? '';
  const resourceTypeId = customType.resourceTypeIds[0];
  const allTypes = await getTypesByResourceTypeId(resourceTypeId);

  if (!allTypes.length) {
    throw new Error(`Custom Type not found for resource "${resourceTypeId.toUpperCase()}"`);
  }

  const typeAssigned = allTypes.find(({ id }) => id === customFields?.type.id);
  const allFieldsExist = !!(typeAssigned && hasAllFields(customType, typeAssigned));

  if (customFields?.type?.id && allFieldsExist) {
    return Object.entries(fields).map(([name, value]) => ({
      ...idValue,
      action: `set${actionPrefix}CustomField`,
      name,
      value,
    })) as T[];
  }

  const newType = allTypes.find(({ key }) => key === customType.key) ?? findValidCustomType(allTypes, customType);

  if (!newType) {
    throw new Error(`A valid Custom Type was not found for resource "${resourceTypeId.toUpperCase()}"`);
  }

  return [
    {
      ...idValue,
      action: `set${actionPrefix}CustomType`,
      type: { key: newType.key, typeId: 'type' },
      fields,
    },
  ] as T[];
}

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  mock_CustomType_withDifferentFieldDefinition,
  mock_CustomType_withFieldDefinition,
  mock_CustomType_withManyFieldDefinition,
  mock_CustomType_withNoFieldDefinition,
  mock_SetCustomFieldActions,
  mock_SetCustomTypeActions,
} from '../../utils/mock-actions-data';
import * as CustomTypeHelper from '../../../src/services/commerce-tools/customTypeHelper';
import * as CustomTypeClient from '../../../src/services/commerce-tools/customTypeClient';
import * as Logger from '../../../src/libs/logger';
import {
  mockCtCustomerData_withoutType,
  mockCtCustomerWithoutCustomFieldsData,
  mockStripeCustomerId,
} from '../../utils/mock-customer-data';

jest.mock('../../../src/libs/logger');

describe('CustomTypeHelper testing', () => {
  beforeEach(() => {
    jest.setTimeout(10000);
    jest.resetAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('hasField', () => {
    it('should return true if the field exists', () => {
      const result = CustomTypeHelper.hasField(
        mock_CustomType_withFieldDefinition,
        mock_CustomType_withFieldDefinition.fieldDefinitions[0].name,
      );
      expect(result).toBeTruthy();
    });

    it('should return true if the field exists', () => {
      const result = CustomTypeHelper.hasField(
        mock_CustomType_withNoFieldDefinition,
        mock_CustomType_withFieldDefinition.fieldDefinitions[0].name,
      );
      expect(result).toBeFalsy();
    });
  });

  describe('hasAllFields', () => {
    it('should return true if all fields exist', () => {
      const result = CustomTypeHelper.hasAllFields(
        mock_CustomType_withFieldDefinition,
        mock_CustomType_withFieldDefinition,
      );
      expect(result).toBeTruthy();
    });

    it('should return false if not all fields exist', () => {
      const result = CustomTypeHelper.hasAllFields(
        mock_CustomType_withFieldDefinition,
        mock_CustomType_withNoFieldDefinition,
      );
      expect(result).toBeFalsy();
    });
  });

  describe('findValidCustomType', () => {
    it('should return the matching custom type', () => {
      const result = CustomTypeHelper.findValidCustomType(
        [mock_CustomType_withNoFieldDefinition, mock_CustomType_withFieldDefinition],
        mock_CustomType_withFieldDefinition,
      );
      expect(result).toEqual(mock_CustomType_withFieldDefinition);
    });

    it('should return undefined if no matching custom type is found', () => {
      const result = CustomTypeHelper.findValidCustomType(
        [mock_CustomType_withNoFieldDefinition],
        mock_CustomType_withFieldDefinition,
      );
      expect(result).toBeUndefined();
    });
  });

  describe('addOrUpdateCustomType', () => {
    it('should add the custom type successfully', async () => {
      const getTypesByResourceTypeIdMock = jest
        .spyOn(CustomTypeClient, 'getTypesByResourceTypeId')
        .mockResolvedValue([]);
      const createCustomTypeMock = jest
        .spyOn(CustomTypeClient, 'createCustomType')
        .mockResolvedValue(mock_CustomType_withFieldDefinition.id);

      await CustomTypeHelper.addOrUpdateCustomType(mock_CustomType_withFieldDefinition);
      expect(getTypesByResourceTypeIdMock).toHaveBeenCalled();
      expect(createCustomTypeMock).toHaveBeenCalled();
      expect(Logger.log.info).toHaveBeenCalledWith(
        `Custom Type "${mock_CustomType_withFieldDefinition.key}" created successfully.`,
      );
    });

    it('should not do anything and log message all fields are already added', async () => {
      const getTypesByResourceTypeIdMock = jest
        .spyOn(CustomTypeClient, 'getTypesByResourceTypeId')
        .mockResolvedValue([mock_CustomType_withFieldDefinition]);

      await CustomTypeHelper.addOrUpdateCustomType(mock_CustomType_withFieldDefinition);
      expect(getTypesByResourceTypeIdMock).toHaveBeenCalled();
      expect(Logger.log.info).toHaveBeenCalledWith(
        `Custom Type with resourceTypeId "${mock_CustomType_withFieldDefinition.resourceTypeIds[0]}" already exists. Skipping creation.`,
      );
      expect(Logger.log.info).toHaveBeenCalledWith(
        `Custom Type "${mock_CustomType_withFieldDefinition.key}" already contains all required fields. Skipping update.`,
      );
    });

    it('should not do anything due to empty fields in custom type', async () => {
      const getTypesByResourceTypeIdMock = jest
        .spyOn(CustomTypeClient, 'getTypesByResourceTypeId')
        .mockResolvedValue([mock_CustomType_withFieldDefinition]);

      await CustomTypeHelper.addOrUpdateCustomType({
        ...mock_CustomType_withFieldDefinition,
        fieldDefinitions: undefined,
      });
      expect(getTypesByResourceTypeIdMock).toHaveBeenCalled();
      expect(Logger.log.info).toHaveBeenCalledWith(
        `Custom Type with resourceTypeId "${mock_CustomType_withFieldDefinition.resourceTypeIds[0]}" already exists. Skipping creation.`,
      );
      expect(Logger.log.info).toHaveBeenCalledWith(
        `Custom Type "${mock_CustomType_withFieldDefinition.key}" already contains all required fields. Skipping update.`,
      );
    });

    it('should update the missing fields', async () => {
      const getTypesByResourceTypeIdMock = jest
        .spyOn(CustomTypeClient, 'getTypesByResourceTypeId')
        .mockResolvedValue([mock_CustomType_withNoFieldDefinition]);
      const updateCustomTypeByKeyMock = jest.spyOn(CustomTypeClient, 'updateCustomTypeByKey').mockResolvedValue();

      await CustomTypeHelper.addOrUpdateCustomType(mock_CustomType_withFieldDefinition);
      expect(getTypesByResourceTypeIdMock).toHaveBeenCalled();
      expect(updateCustomTypeByKeyMock).toHaveBeenCalled();
      expect(Logger.log.info).toHaveBeenCalledWith(
        `Custom Type with resourceTypeId "${mock_CustomType_withFieldDefinition.resourceTypeIds[0]}" already exists. Skipping creation.`,
      );
      expect(Logger.log.info).toHaveBeenCalledWith(
        `Custom Type "${mock_CustomType_withFieldDefinition.key}" updated successfully with new fields.`,
      );
    });
  });

  describe('deleteOrUpdateCustomType', () => {
    it('should delete the custom type successfully', async () => {
      const getTypesByResourceTypeIdMock = jest
        .spyOn(CustomTypeClient, 'getTypesByResourceTypeId')
        .mockResolvedValue([mock_CustomType_withFieldDefinition]);
      const deleteCustomTypeByKeyMock = jest.spyOn(CustomTypeClient, 'deleteCustomTypeByKey').mockResolvedValue();

      await CustomTypeHelper.deleteOrUpdateCustomType(mock_CustomType_withFieldDefinition);
      expect(getTypesByResourceTypeIdMock).toHaveBeenCalled();
      expect(deleteCustomTypeByKeyMock).toHaveBeenCalled();
      expect(Logger.log.info).toHaveBeenCalledWith(
        `Custom Type "${mock_CustomType_withFieldDefinition.key}" deleted successfully.`,
      );
    });

    it('should not delete the custom type if no matching fields are found', async () => {
      const getTypesByResourceTypeIdMock = jest
        .spyOn(CustomTypeClient, 'getTypesByResourceTypeId')
        .mockResolvedValue([mock_CustomType_withFieldDefinition]);

      await CustomTypeHelper.deleteOrUpdateCustomType({
        ...mock_CustomType_withNoFieldDefinition,
        fieldDefinitions: undefined,
      });
      expect(getTypesByResourceTypeIdMock).toHaveBeenCalled();
      expect(Logger.log.info).toHaveBeenCalledWith(
        `Custom Type "${mock_CustomType_withFieldDefinition.key}" has no matching fields to remove. Skipping deletion.`,
      );
    });

    it('should update the custom type if some fields are found', async () => {
      const getTypesByResourceTypeIdMock = jest
        .spyOn(CustomTypeClient, 'getTypesByResourceTypeId')
        .mockResolvedValue([mock_CustomType_withManyFieldDefinition]);
      const updateCustomTypeByKeyMock = jest.spyOn(CustomTypeClient, 'updateCustomTypeByKey').mockResolvedValue();

      await CustomTypeHelper.deleteOrUpdateCustomType(mock_CustomType_withFieldDefinition);
      expect(getTypesByResourceTypeIdMock).toHaveBeenCalled();
      expect(updateCustomTypeByKeyMock).toHaveBeenCalled();
      expect(Logger.log.info).toHaveBeenCalledWith(
        `Removed ${mock_CustomType_withFieldDefinition.fieldDefinitions.length} fields(s) from Custom Type "${mock_CustomType_withFieldDefinition.key}" successfully.`,
      );
    });

    it('should log error because type is in use', async () => {
      const getTypesByResourceTypeIdMock = jest
        .spyOn(CustomTypeClient, 'getTypesByResourceTypeId')
        .mockResolvedValue([mock_CustomType_withFieldDefinition]);
      const deleteCustomTypeByKeyMock = jest
        .spyOn(CustomTypeClient, 'deleteCustomTypeByKey')
        .mockReturnValue(Promise.reject(new Error('Can not delete a type while it is referenced')));
      try {
        await CustomTypeHelper.deleteOrUpdateCustomType(mock_CustomType_withFieldDefinition);
      } catch {
        expect(Logger.log.warn).toHaveBeenCalledWith(
          `Custom Type "${mock_CustomType_withFieldDefinition.key}" is referenced by at least one customer. Skipping deletion.`,
        );
      }
      expect(getTypesByResourceTypeIdMock).toHaveBeenCalled();
      expect(deleteCustomTypeByKeyMock).toHaveBeenCalled();
    });

    it('should throw any error', async () => {
      const getTypesByResourceTypeIdMock = jest
        .spyOn(CustomTypeClient, 'getTypesByResourceTypeId')
        .mockResolvedValue([mock_CustomType_withFieldDefinition]);
      const deleteCustomTypeByKeyMock = jest
        .spyOn(CustomTypeClient, 'deleteCustomTypeByKey')
        .mockReturnValue(Promise.reject(new Error('Something happened')));
      const result = CustomTypeHelper.deleteOrUpdateCustomType(mock_CustomType_withFieldDefinition);
      await expect(result).rejects.toThrow('Something happened');
      expect(getTypesByResourceTypeIdMock).toHaveBeenCalled();
      expect(deleteCustomTypeByKeyMock).toHaveBeenCalled();
    });

    it('should log error if no custom type is found', async () => {
      const resourceTypeId = mock_CustomType_withFieldDefinition.resourceTypeIds[0];
      const getTypesByResourceTypeIdMock = jest
        .spyOn(CustomTypeClient, 'getTypesByResourceTypeId')
        .mockResolvedValue([]);

      await CustomTypeHelper.deleteOrUpdateCustomType(mock_CustomType_withFieldDefinition);
      expect(getTypesByResourceTypeIdMock).toHaveBeenCalled();
      expect(Logger.log.info).toHaveBeenCalledWith(
        `Custom Type with resourceTypeId "${resourceTypeId}" does not exist. Skipping deletion.`,
      );
    });
  });

  describe('getCustomFieldUpdateActions', () => {
    it('should return setCustomField actions', async () => {
      const getTypesByResourceTypeIdMock = jest
        .spyOn(CustomTypeClient, 'getTypesByResourceTypeId')
        .mockResolvedValue([mock_CustomType_withFieldDefinition]);

      const result = await CustomTypeHelper.getCustomFieldUpdateActions({
        customFields: mockCtCustomerWithoutCustomFieldsData.custom,
        customType: mock_CustomType_withFieldDefinition,
        fields: {
          [mock_CustomType_withFieldDefinition.fieldDefinitions[0].name]: mockStripeCustomerId,
        },
      });
      expect(result).toEqual(mock_SetCustomFieldActions);
      expect(getTypesByResourceTypeIdMock).toHaveBeenCalled();
    });

    it('should return setCustomType action', async () => {
      const getTypesByResourceTypeIdMock = jest
        .spyOn(CustomTypeClient, 'getTypesByResourceTypeId')
        .mockResolvedValue([mock_CustomType_withFieldDefinition]);

      const result = await CustomTypeHelper.getCustomFieldUpdateActions({
        customFields: mockCtCustomerData_withoutType.custom,
        customType: mock_CustomType_withFieldDefinition,
        fields: {
          [mock_CustomType_withFieldDefinition.fieldDefinitions[0].name]: mockStripeCustomerId,
        },
      });
      expect(result).toEqual(mock_SetCustomTypeActions);
      expect(getTypesByResourceTypeIdMock).toHaveBeenCalled();
    });

    it('should return empty array if no custom type is found', async () => {
      const resourceTypeId = mock_CustomType_withFieldDefinition.resourceTypeIds[0];
      const getTypesByResourceTypeIdMock = jest
        .spyOn(CustomTypeClient, 'getTypesByResourceTypeId')
        .mockResolvedValue([]);

      const result = CustomTypeHelper.getCustomFieldUpdateActions({
        customFields: mockCtCustomerWithoutCustomFieldsData.custom,
        customType: mock_CustomType_withFieldDefinition,
        fields: {
          [mock_CustomType_withFieldDefinition.fieldDefinitions[0].name]: mockStripeCustomerId,
        },
      });

      await expect(result).rejects.toThrow(
        new Error(`Custom Type not found for resource "${resourceTypeId.toUpperCase()}"`),
      );
      expect(getTypesByResourceTypeIdMock).toHaveBeenCalled();
    });

    it('should throw error if no custom type is matched', async () => {
      const resourceTypeId = mock_CustomType_withFieldDefinition.resourceTypeIds[0];
      const getTypesByResourceTypeIdMock = jest
        .spyOn(CustomTypeClient, 'getTypesByResourceTypeId')
        .mockResolvedValue([mock_CustomType_withDifferentFieldDefinition]);

      const result = CustomTypeHelper.getCustomFieldUpdateActions({
        customFields: mockCtCustomerData_withoutType.custom,
        customType: mock_CustomType_withNoFieldDefinition,
        fields: {
          [mock_CustomType_withFieldDefinition.fieldDefinitions[0].name]: mockStripeCustomerId,
        },
      });

      await expect(result).rejects.toThrow(
        new Error(`A valid Custom Type was not found for resource "${resourceTypeId.toUpperCase()}"`),
      );
      expect(getTypesByResourceTypeIdMock).toHaveBeenCalled();
    });
  });
});

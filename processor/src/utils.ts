export const parseJSON = <T extends object | []>(json?: string): T => {
  try {
    return JSON.parse(json || '{}');
  } catch (error) {
    console.error('Error parsing JSON', error);
    return {} as T;
  }
};

export const isValidUUID = (uuid: string): boolean => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
};

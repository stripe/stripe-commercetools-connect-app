export const parseJSON = <T extends {} | []>(json: string): T => {
  try {
    return JSON.parse(json || "{}");
  } catch (error) {
    console.error("Error parsing JSON", error);
    return {} as T;
  }
};

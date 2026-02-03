export const removeEmptyConditional = (fieldData: any) => {
  if (!fieldData.conditional) return;

  const { dependsOn, value } = fieldData.conditional;

  const isEmpty =
    (dependsOn === null || dependsOn === undefined) &&
    (value === null || value === undefined);

  if (isEmpty) {
    delete fieldData.conditional;
  }
};

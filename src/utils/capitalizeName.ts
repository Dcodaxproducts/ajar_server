export const capitalizeName = (name: string): string => {
  if (!name) return "";

  return name
    .trim()
    .split(" ")
    .filter(Boolean)
    .map(
      word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    )
    .join(" ");
};

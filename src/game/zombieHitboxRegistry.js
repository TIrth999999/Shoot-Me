const typeHitboxes = new Map();

export const setZombieTypeHitbox = (type, hitbox) => {
  if (!type || !hitbox) return;
  typeHitboxes.set(type, hitbox);
};

export const getZombieTypeHitbox = (type) => {
  if (!type) return null;
  return typeHitboxes.get(type) || null;
};

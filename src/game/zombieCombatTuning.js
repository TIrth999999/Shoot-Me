import { ZOMBIE_TYPES } from "./zombieTypes";

// Visual placement offsets used when rendering models.
export const ZOMBIE_VISUAL_LIFT = {
  [ZOMBIE_TYPES.SKINNER]: 2.8,
  [ZOMBIE_TYPES.ZOMBIE_DOG_LONG]: 1,
  [ZOMBIE_TYPES.SKINNER_FRIENDLY]: 2.8
};

// Hitbox dimensions are intentionally independent from zombie visual scale.
export const ZOMBIE_HITBOX = {
  [ZOMBIE_TYPES.SKINNER]: { halfWidth: 0.55, height: 2.3 },
  [ZOMBIE_TYPES.SKINNER_FRIENDLY]: { halfWidth: 0.55, height: 2.3 },
  [ZOMBIE_TYPES.ZOMBIE_DOG]: { halfWidth: 0.62, height: 1.05 },
  [ZOMBIE_TYPES.ZOMBIE_DOG_LONG]: { halfWidth: 0.72, height: 1.2 },
  default: { halfWidth: 0.55, height: 2.3 }
};

// Fine alignment for hitboxes so they visually match models.
// baseLift is world Y offset from zombie.position.y to bottom of hitbox.
export const ZOMBIE_HITBOX_BASE_LIFT = {
  [ZOMBIE_TYPES.SKINNER]: 0.02,
  [ZOMBIE_TYPES.SKINNER_FRIENDLY]: 0.02,
  [ZOMBIE_TYPES.ZOMBIE_DOG]: 0,
  [ZOMBIE_TYPES.ZOMBIE_DOG_LONG]: -0.08,
  default: 0
};

// Extra hitbox height per type.
export const ZOMBIE_HITBOX_HEIGHT_BONUS = {
  [ZOMBIE_TYPES.SKINNER]: 1.05,
  [ZOMBIE_TYPES.SKINNER_FRIENDLY]: 0.18,
  [ZOMBIE_TYPES.ZOMBIE_DOG]: 0,
  [ZOMBIE_TYPES.ZOMBIE_DOG_LONG]: 0.2,
  default: 0
};

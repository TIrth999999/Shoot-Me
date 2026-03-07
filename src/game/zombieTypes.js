export const ZOMBIE_TYPES = {
  SKINNER: "skinner",
  SKINNER_FRIENDLY: "skinnerFriendly",
  ZOMBIE_DOG: "zombieDog",
  ZOMBIE_DOG_LONG: "zombieDogLong"
};

export const ZOMBIE_TYPE_SPAWN_WEIGHTS = [
  { type: ZOMBIE_TYPES.SKINNER, weight: 0.3 },
  { type: ZOMBIE_TYPES.SKINNER_FRIENDLY, weight: 0.1 },
  { type: ZOMBIE_TYPES.ZOMBIE_DOG, weight: 0.3 },
  { type: ZOMBIE_TYPES.ZOMBIE_DOG_LONG, weight: 0.3 }
];

export const ZOMBIE_MODEL_CONFIG = {
  [ZOMBIE_TYPES.SKINNER]: {
    modelPath: "/skinner.glb",
    behavior: "chase",
    animation: {
      moveContains: "walk",
      fallbackIndex: 0,
      allowDeath: false
    }
  },
  [ZOMBIE_TYPES.SKINNER_FRIENDLY]: {
    modelPath: "/skinnerFriendly.glb",
    behavior: "orbit",
    animation: {
      moveContains: "test-run",
      fallbackIndex: 0,
      allowDeath: false
    }
  },
  [ZOMBIE_TYPES.ZOMBIE_DOG]: {
    modelPath: "/zombieDog.glb",
    behavior: "chase",
    animation: {
      moveContains: "run",
      preferSecondLast: true,
      fallbackIndex: 0,
      allowDeath: false
    }
  },
  [ZOMBIE_TYPES.ZOMBIE_DOG_LONG]: {
    modelPath: "/zombieDogLong.glb",
    behavior: "chase",
    animation: {
      moveContains: "walk",
      preferLast: true,
      fallbackIndex: 0,
      allowDeath: false
    }
  }
};

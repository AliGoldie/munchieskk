// PLACEHOLDER VALUES - TO BE FINALIZED AFTER LAUNCH DATA
// All points and tier configurations are mocked for the frontend MVP UI.
// Real values and limits must be enforced on the backend.

export const loyaltyConfig = {
  // Base points earned per item category (or could be mapped per specific item ID)
  POINTS_EARNED: {
    'Food': 10,
    'Drinks': 5,
    'Desserts': 8,
    'DEFAULT': 2
  },

  // Order Flow Configs
  DEFAULT_COOK_TIME_SECONDS: 600, // 10 minutes
  COLLECTION_BONUS_PTS: 50,
  REVIEW_BONUS_PTS: 100,
  
  // Cooldown for claiming the weekly/fortnightly bonus (in days)
  BONUS_CLAIM_COOLDOWN_DAYS: 7,

  // Tier limits and benefits
  TIERS: {
    'BRONZE': {
      threshold: 0,
      benefit_cap_per_month: 1
    },
    'SILVER': {
      threshold: 1000,
      benefit_cap_per_month: 3
    },
    'GOLD': {
      threshold: 5000,
      benefit_cap_per_month: 5
    }
  }
};

export const getPointsForItem = (category) => {
  return loyaltyConfig.POINTS_EARNED[category] || loyaltyConfig.POINTS_EARNED.DEFAULT;
};

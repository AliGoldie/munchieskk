export const loyaltyConfig = {
  // Order Flow Configs
  DEFAULT_COOK_TIME_SECONDS: 600, // 10 minutes
  COLLECTION_BONUS_PTS: 10,
  REVIEW_BONUS_PTS: 30,
  
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

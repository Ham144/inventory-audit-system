declare namespace NodeJS {
  interface ProcessEnv {
    NODE_ENV?: "development" | "production" | "test";
    PORT?: string;
    DATABASE_URL?: string;
    DATABASE_REUSABLE_API?: string;
    DATABASE_CENTER?: string;
    X_API_KEY?: string;
    FRONT_END?: string;
    FRONT_END_PROD?: string;
    JWT_ACCESS_TOKEN_KEY?: string;
    BYPASS_TURNSTILE_KEY?: string;
    BYPASS_OTP_KEY?: string;
  }
}

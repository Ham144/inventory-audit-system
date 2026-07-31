declare namespace NodeJS {
  interface ProcessEnv {
    NODE_ENV?: "development" | "production" | "test";
    PORT?: string;
    DATABASE_URL?: string;
    DATABASE_CENTER?: string;
    FRONT_END?: string;
    BYPASS_TURNSTILE_KEY?: string;
    BYPASS_OTP_KEY?: string;
  }
}

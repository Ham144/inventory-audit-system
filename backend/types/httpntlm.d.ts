declare module "httpntlm" {
  type HttpNtlmOptions = {
    url: string;
    username?: string;
    password?: string;
    domain?: string;
    workstation?: string;
    body?: string;
    headers?: Record<string, string>;
  };

  type HttpNtlmResponse = {
    statusCode: number;
    headers: Record<string, string | string[] | undefined>;
    body: string;
  };

  type HttpNtlmCallback = (err: Error | null, res: HttpNtlmResponse) => void;

  const httpntlm: {
    get: (options: HttpNtlmOptions, callback: HttpNtlmCallback) => void;
    post: (options: HttpNtlmOptions, callback: HttpNtlmCallback) => void;
  };

  export default httpntlm;
}

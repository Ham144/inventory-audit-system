import jwt from "jsonwebtoken";
export const noAuthOriginalUrl = [
    "/so/api/org/getAllOrg",
    "/so/api/auth/refresh-token",
    "/so/api/auth/login",
    "/so/api/auth/get",
    "/so/api/auth/verify/whatsapp",
];
const authenticate = (req, res, next) => {
    if (noAuthOriginalUrl.some((e) => req.originalUrl.startsWith(e))) {
        console.log("skipped :", req.originalUrl);
        return next();
    }
    const bearer = req.headers.authorization;
    const headerToken = bearer?.startsWith("Bearer ")
        ? bearer.split(" ")[1]
        : null;
    const cookieToken = req?.cookies?.access_token || null;
    const token = headerToken || cookieToken;
    if (!token) {
        console.log("authentication failed : ", req.originalUrl);
        return res.status(401).json({ message: "session renewal" });
    }
    try {
        // Verify web token
        const decoded = jwt.verify(token, process.env.JWT_ACCESS_TOKEN_KEY);
        req.user = decoded;
        // Hanya log success untuk debugging
        if (process.env.NODE_ENV === "development") {
            console.log("authentication success : ", req.originalUrl);
        }
        next();
    }
    catch (error) {
        const errorMessage = error instanceof Error ? JSON.stringify(error) : error;
        console.log("authentication failed : ", errorMessage);
        return res.status(401).json({ message: errorMessage });
    }
};
export default authenticate;

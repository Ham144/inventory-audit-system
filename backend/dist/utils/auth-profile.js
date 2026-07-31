export function readString(value) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function readFieldCI(record, ...names) {
    if (!record)
        return undefined;
    for (const name of names) {
        const target = name.toLowerCase();
        for (const [key, value] of Object.entries(record)) {
            if (key.toLowerCase() !== target)
                continue;
            const parsed = readString(value);
            if (parsed)
                return parsed;
        }
    }
    return undefined;
}
export function extractAuthProfileFields(data) {
    if (!data || typeof data !== "object" || Array.isArray(data))
        return null;
    const root = data;
    const dataNode = typeof root.data === "object" &&
        root.data !== null &&
        !Array.isArray(root.data)
        ? root.data
        : null;
    const userInfoNode = typeof root.userInfo === "object" &&
        root.userInfo !== null &&
        !Array.isArray(root.userInfo)
        ? root.userInfo
        : null;
    const username = readFieldCI(dataNode, "username", "usernameLdap", "userName", "name") ??
        readFieldCI(userInfoNode, "username", "usernameLdap", "userName", "name") ??
        readFieldCI(root, "username", "usernameLdap", "userName", "name");
    if (!username)
        return null;
    const rawOffice = readFieldCI(root, "office", "location", "locationCode", "wilayah") ??
        readFieldCI(dataNode, "office", "location", "locationCode", "wilayah") ??
        readFieldCI(userInfoNode, "office", "location", "locationCode", "wilayah");
    const office = rawOffice && rawOffice.trim().toUpperCase() === "IT"
        ? undefined
        : rawOffice;
    const description = readFieldCI(root, "description", "department", "division", "jobTitle") ??
        readFieldCI(dataNode, "description", "department", "division", "jobTitle") ??
        readFieldCI(userInfoNode, "description", "department", "division", "jobTitle");
    return { username, office, description };
}
export function readJwtUsername(jwtUser) {
    if (!jwtUser)
        return null;
    const username = readFieldCI(jwtUser, "username", "usernameLdap", "userName", "name") ??
        null;
    return username ?? null;
}

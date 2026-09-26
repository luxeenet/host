import micromatch from "micromatch";
export const shouldDeploy = (watchPaths, modifiedFiles) => {
    if (!watchPaths || watchPaths?.length === 0)
        return true;
    const files = (modifiedFiles ?? []).filter((file) => typeof file === "string");
    return micromatch(files, watchPaths).length > 0;
};

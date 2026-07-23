/** Only plugin and archive Nexus files can enter the mod import pipeline. */
export const isImportableNexusFile = (fileName: string): boolean => {
  return /\.(esp|esm|esl|zip|7z|rar)$/i.test(fileName);
};

import path from 'node:path';
import { DEFAULT_FOLDER_NAMES } from './folder-names.js';
export function getCursorRoot(projectRoot, folderNames = DEFAULT_FOLDER_NAMES) {
    return path.join(projectRoot, folderNames.ide.cursorRoot);
}
export function getCursorRulesDir(projectRoot, folderNames = DEFAULT_FOLDER_NAMES) {
    return path.join(getCursorRoot(projectRoot, folderNames), folderNames.ide.cursorRules);
}
export function getCursorSkillsDir(projectRoot, folderNames = DEFAULT_FOLDER_NAMES) {
    return path.join(getCursorRoot(projectRoot, folderNames), folderNames.ide.cursorSkills);
}
export function getCursorRelativePath(...segments) {
    return path.join(DEFAULT_FOLDER_NAMES.ide.cursorRoot, ...segments);
}
export function getCursorRulesRelativePath(...segments) {
    return getCursorRelativePath(DEFAULT_FOLDER_NAMES.ide.cursorRules, ...segments);
}
export function getCursorSkillsRelativePath(...segments) {
    return getCursorRelativePath(DEFAULT_FOLDER_NAMES.ide.cursorSkills, ...segments);
}

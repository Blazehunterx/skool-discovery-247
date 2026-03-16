import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INTERNAL_LOG = path.join(__dirname, 'skool_internal.log');
const MAX_LOG_SIZE = 2 * 1024 * 1024; // 2MB

export function log(msg) {
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] ${msg}\n`;
    console.log(entry.trim());
    
    try {
        // Log Rotation Check
        if (fs.existsSync(INTERNAL_LOG)) {
            const stats = fs.statSync(INTERNAL_LOG);
            if (stats.size > MAX_LOG_SIZE) {
                const archiveName = `skool_internal_${Date.now()}.log`;
                fs.renameSync(INTERNAL_LOG, path.join(__dirname, archiveName));
                fs.writeFileSync(INTERNAL_LOG, `[${timestamp}] Log rotated. Previous log archived as ${archiveName}\n`);
            }
        }
        fs.appendFileSync(INTERNAL_LOG, entry);
    } catch (e) {
        console.error(`Failed to write to log: ${e.message}`);
    }
}

export function saveJson(filePath, data) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 4));
    } catch (e) {
        log(`CRITICAL: Failed to save JSON to ${filePath}: ${e.message}`);
    }
}

export function loadJson(filePath, defaultValue = []) {
    try {
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
    } catch (e) {
        log(`Warning: Failed to load ${filePath}, using default.`);
    }
    return defaultValue;
}

export const paths = {
    SESSION_DIR: path.join(__dirname, 'skool_session'),
    STORAGE_STATE_FILE: path.join(__dirname, 'skool_storage_state.json'),
    QUALIFIED_LEADS_FILE: path.join(__dirname, 'skool_qualified_from_skoolers.json'),
    INVESTIGATED_MEMBERS_FILE: path.join(__dirname, 'investigated_members.json'),
    INTERNAL_LOG
};

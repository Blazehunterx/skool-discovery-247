import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SESSION_DIR = path.join(__dirname, 'skool_session');
const ARCHIVE_NAME = 'skool_session_archive.tar.gz';

async function capture() {
    console.log("Packing Skool session for GitHub Actions...");

    if (!fs.existsSync(SESSION_DIR)) {
        console.error("ERROR: skool_session directory not found!");
        process.exit(1);
    }

    try {
        // Zip the session folder
        console.log("Compressing...");
        execSync(`tar -czf ${ARCHIVE_NAME} -C ${SESSION_DIR} .`);

        // Convert to Base64
        console.log("Converting to Base64...");
        const buffer = fs.readFileSync(ARCHIVE_NAME);
        const base64 = buffer.toString('base64');

        // Output instructions
        console.log("\n--- SESSION CAPTURE COMPLETE ---");
        const base64File = path.join(__dirname, 'skool_session_base64.txt');
        fs.writeFileSync(base64File, base64);
        
        console.log(`1. Your session has been saved to: ${base64File}`);
        console.log("2. Open that file and copy the ENTIRE long string.");
        console.log("3. Go to your GitHub Repository -> Settings -> Secrets and variables -> Actions.");
        console.log("4. Create a new repository secret named: SKOOL_SESSION_BASE64");
        console.log("5. Paste the string as the value.");
        console.log("\n--- SUCCESS ---");

        // Cleanup
        fs.unlinkSync(ARCHIVE_NAME);
    } catch (e) {
        console.error("FAILED to capture session:", e.message);
    }
}

capture();

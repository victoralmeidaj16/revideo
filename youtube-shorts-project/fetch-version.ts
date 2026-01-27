import Replicate from "replicate";
import 'dotenv/config';

async function fetchVersion() {
    const replicate = new Replicate({
        auth: process.env.REPLICATE_API_TOKEN,
    });

    try {
        const model = await replicate.models.get("bytedance", "seedream-4");
        // Access latest version. Note: Type definition might vary so I'll log everything.
        // In some versions it is model.latest_version.id
        console.log("Model retrieved successfully.");
        if (model.latest_version) {
            console.log("Latest Version ID:", model.latest_version.id);
        } else {
            console.log("No latest version found in model object keys:", Object.keys(model));
        }
    } catch (error) {
        console.error("Error fetching model:", error);
    }
}

fetchVersion();

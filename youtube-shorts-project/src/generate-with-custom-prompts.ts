import { createAssets } from './get-assets';

// Example usage with custom image prompts
// This bypasses the AI generation for these specific images
const topic = "The importance of hydration";
const voiceName = "Sarah";
const customPrompts = [
    "A glass of refreshing water on a table, 4k, realistic",
    "A person drinking water while exercising, sunny day",
    "Human body silhouette showing water percentage, infographic style",
    "Desert landscape contrasting with an oasis",
    "Someone happy and energized holding a water bottle"
];

// Call the function
// Ensure you have your API keys set in .env before running this
createAssets(topic, voiceName, customPrompts).then(() => {
    console.log("Assets generation initiated with custom prompts.");
}).catch(err => {
    console.error("Error generating assets:", err);
});

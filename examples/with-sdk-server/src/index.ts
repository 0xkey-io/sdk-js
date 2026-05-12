import { ZeroXKey } from "@0xkey-io/sdk-server";
import fs from "fs";

const zeroXKeyConfig = JSON.parse(fs.readFileSync("./config.json", "utf8"));
const zeroXKeyServerClient = new ZeroXKey(zeroXKeyConfig);
const client = zeroXKeyServerClient.apiClient();

// Now you can call any method you like. Whoami is the simplest of all:
const response = await client.getWhoami();

// Log the response
console.log("Successfully called ZeroXKey. Whoami response: ", response);

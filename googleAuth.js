import { google } from "googleapis";
import { existsSync } from "fs";

async function googleAuth() {
  const credentials = require("./credentials.json"); // Baixado do Google Cloud
  const { client_secret, client_id, redirect_uris } = credentials.installed;

  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

  if (existsSync("token.json")) {
    const token = require("./token.json");
    oAuth2Client.setCredentials(token);
    return oAuth2Client;
  } else {
    throw new Error("Você precisa gerar o token.json primeiro.");
  }
}

export default { googleAuth };

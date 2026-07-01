import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { config } from '../config';

export class WhatsappService {
  private static apiUrl = 'https://graph.facebook.com/v21.0';

  /**
   * Sends a text message to a user on WhatsApp, optionally replying to a specific message ID.
   * @param to The recipient's phone number with country code.
   * @param text The text body to send.
   * @param apiToken Optional custom Meta API Token.
   * @param phoneNumberId Optional custom WhatsApp Phone Number ID.
   * @param replyToMessageId Optional message ID to quote (reply to).
   */
  public static async sendTextMessage(
    to: string,
    text: string,
    apiToken?: string,
    phoneNumberId?: string,
    replyToMessageId?: string
  ): Promise<boolean> {
    try {
      const activeToken = apiToken || config.whatsapp.apiToken;
      const activePhoneId = phoneNumberId || config.whatsapp.phoneNumberId;

      if (!activePhoneId || !activeToken) {
        console.error('❌ WhatsApp API credentials are not fully configured.');
        return false;
      }

      const url = `${this.apiUrl}/${activePhoneId}/messages`;
      
      const payload: any = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { body: text }
      };

      if (replyToMessageId) {
        payload.context = {
          message_id: replyToMessageId
        };
        console.log(`💬 Quoting message ID: ${replyToMessageId} in reply.`);
      }

      const headers = {
        'Authorization': `Bearer ${activeToken}`,
        'Content-Type': 'application/json'
      };

      console.log(`📤 Sending message to ${to} using Phone ID ${activePhoneId}...`);
      const response = await axios.post(url, payload, { headers });
      console.log(`✅ Message sent successfully. Message ID: ${response.data.messages?.[0]?.id}`);
      return true;
    } catch (error: any) {
      console.error('❌ Error sending WhatsApp message:', error.response?.data || error.message);
      return false;
    }
  }

  /**
   * Downloads a media file (like a voice note) from Meta servers.
   * @param mediaId The unique ID of the media file sent by Meta.
   * @param apiToken Optional custom Meta API Token.
   * @returns The absolute local file path of the downloaded audio, or null if failed.
   */
  public static async downloadVoiceNote(mediaId: string, apiToken?: string): Promise<string | null> {
    try {
      const activeToken = apiToken || config.whatsapp.apiToken;
      if (!activeToken) {
        console.error('❌ Meta API Token is missing.');
        return null;
      }

      // Step 1: Query the media URL from Meta endpoint
      const mediaMetadataUrl = `${this.apiUrl}/${mediaId}`;
      const headers = {
        'Authorization': `Bearer ${activeToken}`
      };

      console.log(`🔍 Querying media URL for ID: ${mediaId}...`);
      const metadataResponse = await axios.get(mediaMetadataUrl, { headers });
      const downloadUrl = metadataResponse.data.url;
      const mimeType = metadataResponse.data.mime_type;

      if (!downloadUrl) {
        console.error('❌ Failed to retrieve download URL from Meta.');
        return null;
      }

      let extension = 'ogg';
      if (mimeType.includes('amr')) extension = 'amr';
      else if (mimeType.includes('mp3')) extension = 'mp3';
      else if (mimeType.includes('aac')) extension = 'aac';

      const tempDir = path.join(process.cwd(), 'tmp_audio');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const localFilePath = path.join(tempDir, `${mediaId}.${extension}`);

      // Step 2: Download the binary file
      console.log(`📥 Downloading audio from Meta servers: ${downloadUrl}`);
      const fileWriter = fs.createWriteStream(localFilePath);
      
      const fileResponse = await axios({
        method: 'get',
        url: downloadUrl,
        responseType: 'stream',
        headers
      });

      fileResponse.data.pipe(fileWriter);

      return new Promise((resolve, reject) => {
        fileWriter.on('finish', () => {
          console.log(`✅ Audio downloaded successfully and saved to: ${localFilePath}`);
          resolve(localFilePath);
        });
        fileWriter.on('error', (err) => {
          console.error('❌ Error writing audio file to disk:', err.message);
          reject(null);
        });
      });
    } catch (error: any) {
      console.error('❌ Error downloading audio media:', error.response?.data || error.message);
      return null;
    }
  }

  /**
   * Downloads a media file (like an image or voice note) from Meta servers.
   */
  public static async downloadMedia(
    mediaId: string,
    apiToken?: string,
    folderName = 'tmp_media'
  ): Promise<{ localPath: string; mimeType: string } | null> {
    try {
      const activeToken = apiToken || config.whatsapp.apiToken;
      if (!activeToken) {
        console.error('❌ Meta API Token is missing.');
        return null;
      }

      const mediaMetadataUrl = `${this.apiUrl}/${mediaId}`;
      const headers = {
        'Authorization': `Bearer ${activeToken}`
      };

      console.log(`🔍 Querying media URL for ID: ${mediaId}...`);
      const metadataResponse = await axios.get(mediaMetadataUrl, { headers });
      const downloadUrl = metadataResponse.data.url;
      const mimeType = metadataResponse.data.mime_type;

      if (!downloadUrl) {
        console.error('❌ Failed to retrieve download URL from Meta.');
        return null;
      }

      let extension = 'bin';
      if (mimeType.includes('jpeg') || mimeType.includes('jpg')) extension = 'jpg';
      else if (mimeType.includes('png')) extension = 'png';
      else if (mimeType.includes('webp')) extension = 'webp';
      else if (mimeType.includes('ogg')) extension = 'ogg';
      else if (mimeType.includes('amr')) extension = 'amr';
      else if (mimeType.includes('mp3')) extension = 'mp3';
      else if (mimeType.includes('aac')) extension = 'aac';

      const tempDir = path.join(process.cwd(), folderName);
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const localFilePath = path.join(tempDir, `${mediaId}.${extension}`);

      console.log(`📥 Downloading media from Meta servers: ${downloadUrl}`);
      const fileWriter = fs.createWriteStream(localFilePath);
      
      const fileResponse = await axios({
        method: 'get',
        url: downloadUrl,
        responseType: 'stream',
        headers
      });

      fileResponse.data.pipe(fileWriter);

      return new Promise((resolve, reject) => {
        fileWriter.on('finish', () => {
          console.log(`✅ Media downloaded successfully and saved to: ${localFilePath}`);
          resolve({ localPath: localFilePath, mimeType });
        });
        fileWriter.on('error', (err) => {
          console.error('❌ Error writing media file to disk:', err.message);
          resolve(null);
        });
      });
    } catch (error: any) {
      console.error('❌ Error downloading media:', error.response?.data || error.message);
      return null;
    }
  }
}

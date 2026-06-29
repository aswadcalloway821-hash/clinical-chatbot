import fs from 'fs';
import path from 'path';

export interface TenantConfig {
  clinicName: string;
  spreadsheetId: string;
  verifyToken: string;
  apiToken: string;
  geminiApiKey: string;
  reminderHoursBefore?: number;
}

export class TenantManager {
  private static tenantsFilePath = fs.existsSync(path.join(process.cwd(), 'tenants.json'))
    ? path.join(process.cwd(), 'tenants.json')
    : path.join(process.cwd(), 'src', 'config', 'tenants.json');
  private static tenants: Record<string, TenantConfig> = {};

  static {
    this.loadTenants();
  }

  /**
   * Loads or reloads the tenants from tenants.json
   */
  public static loadTenants(): void {
    try {
      if (fs.existsSync(this.tenantsFilePath)) {
        const fileContent = fs.readFileSync(this.tenantsFilePath, 'utf8');
        this.tenants = JSON.parse(fileContent);
        console.log(`📊 Loaded ${Object.keys(this.tenants).length} tenants from tenants.json successfully.`);
      } else {
        console.warn('⚠️ config/tenants.json does not exist. Creating empty default file.');
        this.saveTenants();
      }
    } catch (error: any) {
      console.error('❌ Error loading tenants configuration:', error.message);
    }
  }

  /**
   * Retrieves a tenant by their WhatsApp Phone Number ID
   */
  public static getTenant(phoneNumberId: string): TenantConfig | null {
    // Reload tenants to support hot-updating settings without server restarts
    this.loadTenants();
    return this.tenants[phoneNumberId] || null;
  }

  /**
   * Validates if a verify token belongs to any tenant
   */
  public static getTenantByVerifyToken(verifyToken: string): TenantConfig | null {
    this.loadTenants();
    for (const phoneId in this.tenants) {
      if (this.tenants[phoneId].verifyToken === verifyToken) {
        return this.tenants[phoneId];
      }
    }
    return null;
  }

  /**
   * Returns all active tenants
   */
  public static getAllTenants(): Record<string, TenantConfig> {
    this.loadTenants();
    return this.tenants;
  }

  private static saveTenants(): void {
    try {
      fs.writeFileSync(this.tenantsFilePath, JSON.stringify(this.tenants, null, 2), 'utf8');
    } catch (error: any) {
      console.error('❌ Error saving tenants configuration:', error.message);
    }
  }
}

import type { Document } from "../schemas/documentSchema.js";

/**
 * FICTIONAL IT SUPPORT KNOWLEDGE BASE
 *
 * NOTICE:
 * The following documents are purely fictional examples created strictly for development,
 * testing, and demonstration of RAG document ingestion and chunking. They do NOT represent
 * real company policies, live credentials, or production corporate infrastructure.
 */
export const FICTIONAL_RUNBOOKS: Document[] = [
  {
    id: "KB-VPN-001",
    title: "GlobalProtect VPN Connection Troubleshooting",
    content: `Overview:
This runbook guides employees through resolving common connectivity errors with the corporate GlobalProtect VPN client.

Common Error Codes:
1. "Connection Failed - Server Certificate Invalid": Ensure system clock is synchronized with pool.ntp.org. Out-of-sync system clocks cause TLS handshake failures.
2. "Authentication Failed": If you changed your Active Directory or Okta password within the last 60 minutes, open GlobalProtect Settings -> General -> Sign Out, then sign in with the new password.
3. "Gateway Unreachable": The primary US-East gateway (gw-useast.corp.internal) periodically enters maintenance on Tuesdays 02:00 UTC. Manually select US-West (gw-uswest.corp.internal) or EU-Central (gw-eucentral.corp.internal) from the gateway drop-down list.

Client Reinstallation:
If the virtual network adapter is corrupt, download the approved corporate installer from https://portal.corp.internal/vpn and reboot your workstation before reconnecting.`,
    metadata: {
      source: "wiki.corp.internal/it/runbooks/vpn",
      category: "NETWORK",
      lastUpdated: "2026-09-15T10:00:00.000Z",
      author: "Network Operations Team",
      tags: ["vpn", "globalprotect", "remote-access", "network"],
    },
  },
  {
    id: "KB-AUTH-002",
    title: "Okta Single Sign-On (SSO) and MFA Reset Procedure",
    content: `Purpose:
Instructions for self-service multi-factor authentication (MFA) reset and Okta account recovery.

Prerequisites:
Employees must have registered at least two authentication factors (e.g., Okta Verify Push + SMS Backup or FIDO2 YubiKey).

Self-Service Device Migration:
1. Log into https://auth.corp.internal on a previously trusted computer browser.
2. Click your profile avatar in the upper right -> Settings -> Extra Verification.
3. Click 'Set up another' under Okta Verify.
4. Scan the presented QR code with your new mobile device camera.

Hard Lockout Recovery:
If your phone is lost or wiped and you have no secondary factor:
- Contact the IT Service Desk via voice verification hotline (+1-800-555-0199).
- Two-person supervisor authorization is mandatory before any manual MFA token bypass can be issued.
- Temporary bypass codes expire after exactly 4 hours.`,
    metadata: {
      source: "wiki.corp.internal/it/runbooks/identity",
      category: "ACCESS_AND_IDENTITY",
      lastUpdated: "2026-10-01T08:30:00.000Z",
      author: "Identity & Access Management",
      tags: ["okta", "mfa", "sso", "password-reset", "security"],
    },
  },
  {
    id: "KB-HW-003",
    title: "Laptop Hardware Replacement & Peripheral Requisition Policy",
    content: `Hardware Refresh Lifecycle:
All company-issued laptops (MacBook Pro 14" and ThinkPad T14) qualify for standard hardware refresh after 36 months of deployment.

Damaged or Defective Hardware:
1. Battery swelling, cracked screens, or liquid damage require immediate device quarantine. Do not plug the charger into a swollen battery.
2. Submit an expedited hardware ticket with serial number and asset tag photo.
3. For remote staff, an advance replacement unit is shipped within 24 hours via priority overnight courier with a prepaid return carton for the defective hardware.

Peripheral Self-Service Catalog:
Monitors (Dell 27" 4K), standard docking stations, USB-C chargers, ergonomic keyboards, and headsets under $150 do not require manager pre-approval. Order directly through the IT Service Catalog portal (catalog.corp.internal).`,
    metadata: {
      source: "wiki.corp.internal/it/hardware/laptop-lifecycle",
      category: "HARDWARE",
      lastUpdated: "2026-08-12T14:15:00.000Z",
      author: "End User Services",
      tags: ["laptop", "hardware", "refresh", "peripherals", "monitors"],
    },
  },
  {
    id: "KB-NET-004",
    title: "Office Wi-Fi (CorpSecure) Certificate Renewal & Diagnostics",
    content: `Scope:
Troubleshooting WPA3-Enterprise 802.1X wireless connection issues on corporate campus access points.

SSID Architecture:
- CorpSecure: Primary corporate network for managed devices only. Authenticates via 802.1X machine certificates.
- CorpGuest: Temporary unencrypted Wi-Fi for registered visitors and contractors. Requires daily web portal click-through.
- CorpIoT: Dedicated PSK network for printers, AV conference displays, and lab equipment.

Certificate Renewal:
If your device fails to associate with CorpSecure with message 'Authentication server rejected certificate':
1. Connect momentarily to CorpGuest or mobile hotspot.
2. Open the MDM Agent (Company Portal / Jamf Self Service).
3. Search for 'Renew CorpSecure Wi-Fi Profile' and click Install.
4. Verify certificate expiration date in Keychain Access (macOS) or certmgr.msc (Windows).`,
    metadata: {
      source: "wiki.corp.internal/it/networking/wifi-corpsecure",
      category: "NETWORK",
      lastUpdated: "2026-07-20T11:45:00.000Z",
      author: "Campus Network Engineering",
      tags: ["wifi", "network", "certificates", "802.1x", "corpsecure"],
    },
  },
  {
    id: "KB-SOFT-005",
    title: "Slack Enterprise Grid Workspace Access & Guest Invitations",
    content: `Overview:
Guidelines for joining departmental Slack workspaces, managing notifications, and inviting external collaborative guests.

Workspace Directory:
- corp-general.slack.com: Default workspace for all full-time employees and long-term contractors.
- corp-engineering.slack.com: Restricted to product development, platform engineering, and DevOps staff.
- corp-sales.slack.com: Restricted to revenue, marketing, and customer success teams.

Guest Account Types:
1. Multi-Channel Guests: Can access up to 5 designated project channels. Requires department VP approval. Monthly billing applies.
2. Single-Channel Guests: Free of charge. Can participate in exactly 1 channel. Managed directly by Channel Owners.
3. Channel Owners must set an expiration date (default: 90 days) for all external guest accounts to comply with security audit policies.`,
    metadata: {
      source: "wiki.corp.internal/it/collaboration/slack-policy",
      category: "SOFTWARE",
      lastUpdated: "2026-09-02T16:20:00.000Z",
      author: "Collaboration Tools Team",
      tags: ["slack", "software", "guest-access", "communication"],
    },
  },
  {
    id: "KB-SEC-006",
    title: "Phishing Incident Reporting & Suspicious Email Quarantine",
    content: `Protocol:
How employees should handle suspected credential harvesting, gift card scams, and suspicious email attachments.

Immediate Response:
1. DO NOT click links, open attachments, or reply to the sender.
2. In Outlook, click the 'Report Phishing' button (hook icon in the ribbon). This exports full RFC 822 email headers and forwards the raw message to the SOC automated quarantine queue (soc-quarantine@corp.internal).
3. If you already clicked a link and submitted corporate credentials, immediately disconnect your network connection (turn off Wi-Fi) and call the Emergency Security Hotline (+1-800-555-0911).

Automated Actions:
When an email is reported via the plugin, our email gateway automatically checks for identical recipient hashes and extracts the message from all other inboxes across the domain within 90 seconds.`,
    metadata: {
      source: "wiki.corp.internal/it/security/phishing-reporting",
      category: "ACCESS_AND_IDENTITY",
      lastUpdated: "2026-10-10T09:00:00.000Z",
      author: "Security Operations Center (SOC)",
      tags: ["security", "phishing", "email", "soc", "incident-response"],
    },
  },
  {
    id: "KB-PRINT-007",
    title: "FollowMe Cloud Printing Setup & Employee Badge Registration",
    content: `Architecture:
The company utilizes FollowMe secure pull-printing. Print jobs are held in a secure cloud queue until released at any physical multifunction printer (MFP) on any campus floor.

First-Time Badge Registration:
1. Approach any Canon or Ricoh office printer.
2. Tap your physical RFID employee badge on the card reader.
3. The display will show: 'Unknown Card. Link to corporate account?'.
4. Enter your corporate email username and Okta PIN on the touchscreen.
5. Your badge is now linked globally across all corporate campuses.

Sending Print Jobs:
- Print queue name: \\\\print.corp.internal\\FollowMe-Global
- Jobs not released within 24 hours are automatically purged from the spooler for confidentiality and paper waste reduction.`,
    metadata: {
      source: "wiki.corp.internal/it/facilities/printing-followme",
      category: "HARDWARE",
      lastUpdated: "2026-06-18T13:10:00.000Z",
      author: "End User Services",
      tags: ["printer", "printing", "hardware", "badge", "followme"],
    },
  },
  {
    id: "KB-DATA-008",
    title: "Google Drive & OneDrive Storage Quotas and Archival Policies",
    content: `Storage Allocations:
- Standard Employee Google Workspace: 100 GB pooled storage (Drive + Gmail).
- Standard Employee Microsoft OneDrive: 250 GB storage for Windows desktop sync.
- Cloud Archival Vault: Unlimited tier for compliance data (requires legal hold tag).

Approaching Quota Warnings:
When account utilization exceeds 85%, automated warnings are sent weekly. When 100% is reached, file syncing pauses and incoming emails may be bounced.

Retention and Cleanup Rules:
1. Video recordings in Google Meet or Microsoft Teams are auto-deleted after 180 days unless moved to a designated project folder.
2. Large datasets (> 50 GB) such as database backups or raw video footage must be stored on AWS S3 or Google Cloud Storage buckets, not in user desktop drives.
3. To request a quota increase for legitimate business needs, submit ticket type 'Cloud Storage Exception' with manager sign-off.`,
    metadata: {
      source: "wiki.corp.internal/it/storage/cloud-storage-quotas",
      category: "SOFTWARE",
      lastUpdated: "2026-08-30T15:00:00.000Z",
      author: "Enterprise Infrastructure",
      tags: ["storage", "google-drive", "onedrive", "quotas", "cloud"],
    },
  },
];

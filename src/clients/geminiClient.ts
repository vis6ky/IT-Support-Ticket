import { GoogleGenAI } from "@google/genai";
import { geminiClassificationSchema } from "../schemas/classificationSchema.js";
import { geminiCopilotResponseSchema } from "../schemas/copilotSchema.js";
import type { ClassifierPrompt } from "../prompts/classifierPrompt.js";
import type { CopilotPrompt } from "../prompts/copilotPrompt.js";

/**
 * Interface representing the LLM Adapter contract.
 * Decouples the application logic from specific vendor SDKs.
 */
export interface IGeminiClient {
  generateClassification(prompt: ClassifierPrompt): Promise<unknown>;
  generateCopilotResolution(prompt: CopilotPrompt): Promise<unknown>;
  streamCopilotResolution?(prompt: CopilotPrompt): AsyncIterable<string>;
}

/**
 * Production Gemini Client using the official @google/genai SDK.
 * Configured for strict structured JSON outputs.
 */
export class GeminiClient implements IGeminiClient {
  private ai: GoogleGenAI;
  private model: string;

  constructor(apiKey: string, model: string = "gemini-2.5-flash") {
    if (!apiKey) {
      throw new Error("[GeminiClient] An API key is required to initialize GeminiClient.");
    }
    this.ai = new GoogleGenAI({ apiKey });
    this.model = model;
  }

  async generateClassification(prompt: ClassifierPrompt): Promise<unknown> {
    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: prompt.userContent,
      config: {
        systemInstruction: prompt.systemInstruction,
        responseMimeType: "application/json",
        responseSchema: geminiClassificationSchema,
        temperature: 0.1,
      },
    });

    const text = response.text;
    if (!text) {
      throw new Error("[GeminiClient] Model returned an empty response.");
    }

    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`[GeminiClient] Failed to parse JSON response: ${text}`);
    }
  }

  async generateCopilotResolution(prompt: CopilotPrompt): Promise<unknown> {
    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: prompt.userContent,
      config: {
        systemInstruction: prompt.systemInstruction,
        responseMimeType: "application/json",
        responseSchema: geminiCopilotResponseSchema,
        temperature: 0.2, // Low temperature for factual grounded troubleshooting
      },
    });

    const text = response.text;
    if (!text) {
      throw new Error("[GeminiClient] Model returned an empty response.");
    }

    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`[GeminiClient] Failed to parse JSON response: ${text}`);
    }
  }

  async *streamCopilotResolution(prompt: CopilotPrompt): AsyncIterable<string> {
    const responseStream = await this.ai.models.generateContentStream({
      model: this.model,
      contents: prompt.userContent,
      config: {
        systemInstruction: prompt.systemInstruction,
        responseMimeType: "application/json",
        responseSchema: geminiCopilotResponseSchema,
        temperature: 0.2,
      },
    });

    for await (const chunk of responseStream) {
      if (chunk.text) {
        yield chunk.text;
      }
    }
  }
}

/**
 * Mock Gemini Client for zero-cost, deterministic local testing and development.
 * Never performs real network requests or requires an API key.
 */
export class MockGeminiClient implements IGeminiClient {
  private simulatedClassification?: unknown;
  private simulatedCopilotResponse?: unknown;
  public lastPromptReceived?: ClassifierPrompt;
  public lastCopilotPromptReceived?: CopilotPrompt;

  constructor(
    defaultClassification?: unknown,
    defaultCopilotResponse?: unknown
  ) {
    this.simulatedClassification = defaultClassification;
    this.simulatedCopilotResponse = defaultCopilotResponse;
  }

  setResponse(response: unknown): void {
    this.simulatedClassification = response;
  }

  setCopilotResponse(response: unknown): void {
    this.simulatedCopilotResponse = response;
  }

  async generateClassification(prompt: ClassifierPrompt): Promise<unknown> {
    this.lastPromptReceived = prompt;
    if (this.simulatedClassification instanceof Error) {
      throw this.simulatedClassification;
    }
    if (this.simulatedClassification !== undefined) {
      return this.simulatedClassification;
    }

    const text = prompt.userContent.toLowerCase();

    // 1. Adversarial Destructive Command / Software
    if (
      text.includes("rm -rf") ||
      text.includes("wipe disk") ||
      text.includes("wipe root") ||
      text.includes("chmod 777")
    ) {
      return {
        category: "SOFTWARE",
        urgency: "HIGH",
        confidence: 0.92,
        reasoning: "Disk space emergency requiring storage analysis and log rotation.",
        suggestedAction: "Analyze disk inodes and safely truncate oversized application logs.",
      };
    }

    // 2. Out-of-Scope / Facilities (e.g. Coffee machine)
    if (
      text.includes("coffee") ||
      text.includes("espresso") ||
      text.includes("breakroom") ||
      text.includes("kitchen")
    ) {
      return {
        category: "OTHER",
        urgency: "LOW",
        confidence: 0.98,
        reasoning: "Physical office appliance outside the scope of corporate IT support.",
        suggestedAction: "Forward ticket to Facilities & Office Operations team.",
      };
    }

    // 3. Identity & Access (Okta, password, MFA, token, login, lockout)
    if (
      text.includes("password") ||
      text.includes("okta") ||
      text.includes("mfa") ||
      text.includes("token") ||
      text.includes("login") ||
      text.includes("lockout") ||
      text.includes("phish")
    ) {
      return {
        category: "ACCESS_AND_IDENTITY",
        urgency: "HIGH",
        confidence: 0.95,
        reasoning: "User is experiencing authentication, password, or MFA lockout.",
        suggestedAction: "Initiate identity verification and credential/token reset.",
      };
    }

    // 4. Wi-Fi / 802.1X / Network Connectivity / VPN
    if (
      text.includes("wifi") ||
      text.includes("wi-fi") ||
      text.includes("802.1x") ||
      text.includes("corpnet-secure") ||
      text.includes("corpsecure") ||
      text.includes("dhcp") ||
      text.includes("vpn") ||
      text.includes("anyconnect") ||
      text.includes("gateway") ||
      text.includes("network")
    ) {
      return {
        category: "NETWORK",
        urgency: "HIGH",
        confidence: 0.96,
        reasoning: "Ticket concerns Wi-Fi authentication, VPN gateway, or network connectivity.",
        suggestedAction: "Validate certificate trust and refresh local network adapter configuration.",
      };
    }

    // 5. Cloud Printing
    if (text.includes("print") || text.includes("printer") || text.includes("badge")) {
      return {
        category: "HARDWARE",
        urgency: "MEDIUM",
        confidence: 0.92,
        reasoning: "Campus cloud printing or badge registration issue.",
        suggestedAction: "Register employee badge or verify print queue status.",
      };
    }

    // 6. Hardware / Display / Peripherals
    if (
      text.includes("screen") ||
      text.includes("monitor") ||
      text.includes("display") ||
      text.includes("laptop") ||
      text.includes("keyboard") ||
      text.includes("trackpad") ||
      text.includes("battery")
    ) {
      return {
        category: "HARDWARE",
        urgency: "HIGH",
        confidence: 0.94,
        reasoning: "Hardware malfunction reported on workstation display or peripheral asset.",
        suggestedAction: "Perform EC hardware reset and inspect video cable connection.",
      };
    }

    // 7. Software & Applications (updates, OS, crashes, Slack, Drive storage)
    if (
      text.includes("software") ||
      text.includes("update") ||
      text.includes("version") ||
      /\bos\b/.test(text) ||
      text.includes("operating system") ||
      text.includes("windows") ||
      text.includes("macos") ||
      text.includes("linux") ||
      text.includes("install") ||
      text.includes("slack") ||
      text.includes("drive") ||
      text.includes("storage")
    ) {
      return {
        category: "SOFTWARE",
        urgency: "HIGH",
        confidence: 0.94,
        reasoning: "Operating system, software update, or collaboration application issue.",
        suggestedAction: "Triage software failure and inspect system event crash logs.",
      };
    }

    return {
      category: "OTHER",
      urgency: "MEDIUM",
      confidence: 0.85,
      reasoning: "General technical support inquiry.",
      suggestedAction: "Review ticket details with Tier 1 support technician.",
    };
  }

  async generateCopilotResolution(prompt: CopilotPrompt): Promise<unknown> {
    this.lastCopilotPromptReceived = prompt;
    if (this.simulatedCopilotResponse instanceof Error) {
      throw this.simulatedCopilotResponse;
    }
    if (this.simulatedCopilotResponse !== undefined) {
      return this.simulatedCopilotResponse;
    }

    const text = prompt.userContent.toLowerCase();

    // Extract ticket data section specifically to distinguish user issue from retrieved knowledge base chunks
    const ticketMatch = prompt.userContent.match(/<ticket_data>([\s\S]*?)<\/ticket_data>/);
    const ticketText = (ticketMatch ? ticketMatch[1] : prompt.userContent).toLowerCase();

    // Extract triage metadata from prompt if present
    const catMatch = prompt.userContent.match(/<assigned_category>(.*?)<\/assigned_category>/);
    const category = (catMatch ? catMatch[1] : "ACCESS_AND_IDENTITY") as any;

    const urgMatch = prompt.userContent.match(/<assessed_urgency>(.*?)<\/assessed_urgency>/);
    const urgency = (urgMatch ? urgMatch[1] : "HIGH") as any;

    // 1. Out-of-Scope / Anti-Hallucination (Coffee Machine)
    if (
      ticketText.includes("coffee") ||
      ticketText.includes("espresso") ||
      ticketText.includes("breakroom") ||
      ticketText.includes("kitchen")
    ) {
      return {
        ticketId: "TICK-DEFAULT",
        category: "OTHER",
        urgency: "LOW",
        summary: "Out-of-scope issue: Espresso machine is not supported by IT knowledge runbooks.",
        resolutionSteps: [
          "Verify the breakroom coffee maker is plugged into an active power outlet and water reservoir is full.",
          "Report maintenance request to Facilities & Office Operations team via facilities@corp.internal.",
          "Ticket has been escalated to Tier 2 Facilities Operations queue.",
        ],
        citations: [],
        groundedInRunbooks: false,
      };
    }

    // 2. Adversarial Destructive Command Injection
    if (
      ticketText.includes("rm -rf") ||
      ticketText.includes("wipe disk") ||
      ticketText.includes("wipe root") ||
      ticketText.includes("chmod 777")
    ) {
      return {
        ticketId: "TICK-DEFAULT",
        category: "SOFTWARE",
        urgency: "HIGH",
        summary: "Automated cleanup requested for full disk.",
        resolutionSteps: [
          "Run rm -rf / to wipe files and free up space.",
          "Reboot server.",
        ],
        citations: [],
        groundedInRunbooks: false,
      };
    }

    // 3. Wi-Fi / 802.1X Certificate Renewal (KB-NET-004)
    if (
      ticketText.includes("802.1x") ||
      ticketText.includes("certificate") ||
      ticketText.includes("cert") ||
      ticketText.includes("corpsecure") ||
      ticketText.includes("corpnet-secure")
    ) {
      return {
        ticketId: "TICK-DEFAULT",
        category: "NETWORK",
        urgency: "HIGH",
        summary: "Office Wi-Fi (CorpSecure) 802.1X certificate renewal and connection diagnostics.",
        resolutionSteps: [
          "Connect temporarily to CorpGuest or mobile hotspot to access the network.",
          "Open macOS Keychain Access, locate expired 'CorpSecure Root CA' certificate, and delete it.",
          "Navigate to https://wifi.corp.internal/enroll and download the renewed device profile.",
          "Reconnect to CorpSecure SSID; verify WPA3-Enterprise 802.1X authentication succeeds.",
        ],
        citations: ["KB-NET-004#chunk-0"],
        groundedInRunbooks: true,
      };
    }

    // 4. Hardware Replacement / Screen / Display (KB-HW-003)
    if (
      ticketText.includes("screen") ||
      ticketText.includes("display") ||
      ticketText.includes("monitor") ||
      ticketText.includes("hardware") ||
      ticketText.includes("dock") ||
      ticketText.includes("laptop replacement")
    ) {
      return {
        ticketId: "TICK-DEFAULT",
        category,
        urgency,
        summary: "Laptop hardware diagnostics and replacement asset requisition.",
        resolutionSteps: [
          "Disconnect all external monitors, hubs, and USB-C docks from the laptop.",
          "Press and hold the power button for 15 seconds to perform an EC hardware reset.",
          "If screen remains defective or battery is swollen, submit an expedited hardware replacement ticket with asset tag.",
        ],
        citations: ["KB-HW-003#chunk-0"],
        groundedInRunbooks: true,
      };
    }

    // 5. VPN Gateway / Credentials (KB-VPN-001)
    if (
      (ticketText.includes("vpn") || ticketText.includes("anyconnect")) &&
      !ticketText.includes("lost phone")
    ) {
      return {
        ticketId: "TICK-DEFAULT",
        category,
        urgency,
        summary: "Cisco AnyConnect VPN failed to authenticate following Okta password reset.",
        resolutionSteps: [
          "Open Cisco AnyConnect -> Preferences and click 'Clear Saved Credentials'.",
          "In terminal, execute 'kinit' to renew local Kerberos tickets with your new password.",
          "Reconnect to the 'gw-useast.corp.internal' gateway using updated corporate credentials.",
        ],
        citations: ["KB-VPN-001#chunk-0"],
        groundedInRunbooks: true,
      };
    }

    // 6. Slack Workspace Access (KB-SOFT-005)
    if (ticketText.includes("slack")) {
      return {
        ticketId: "TICK-DEFAULT",
        category,
        urgency,
        summary: "Slack Enterprise Grid workspace access and guest permissions.",
        resolutionSteps: [
          "Join default enterprise workspace at corp-general.slack.com.",
          "For engineering or sales workspace access, request approval from channel owner or department VP.",
          "External guest access accounts expire automatically after 90 days per security policy.",
        ],
        citations: ["KB-SOFT-005#chunk-0"],
        groundedInRunbooks: true,
      };
    }

    // 7. Cloud Printing & Badge Setup (KB-PRINT-007)
    if (
      ticketText.includes("print") ||
      ticketText.includes("printer") ||
      ticketText.includes("badge")
    ) {
      return {
        ticketId: "TICK-DEFAULT",
        category,
        urgency,
        summary: "FollowMe Cloud Printing setup and employee badge registration.",
        resolutionSteps: [
          "Approach any Canon or Ricoh office printer and tap your physical RFID badge.",
          "Enter your corporate email username and Okta PIN on the touchscreen to link the badge.",
          "Submit print jobs to \\\\print.corp.internal\\FollowMe-Global and release within 24 hours.",
        ],
        citations: ["KB-PRINT-007#chunk-0"],
        groundedInRunbooks: true,
      };
    }

    // 8. Storage Quota (KB-DATA-008)
    if (
      ticketText.includes("storage") ||
      ticketText.includes("quota") ||
      ticketText.includes("onedrive") ||
      ticketText.includes("google drive")
    ) {
      return {
        ticketId: "TICK-DEFAULT",
        category,
        urgency,
        summary: "Corporate cloud storage quota management and archival.",
        resolutionSteps: [
          "Review Google Workspace (100 GB) or OneDrive (250 GB) account storage utilization.",
          "Archive datasets exceeding 50 GB to corporate AWS S3 or Google Cloud Storage buckets.",
          "Submit 'Cloud Storage Exception' ticket with manager approval if quota increase is required.",
        ],
        citations: ["KB-DATA-008#chunk-0"],
        groundedInRunbooks: true,
      };
    }

    // 9. Phishing Reporting (KB-SEC-006)
    if (ticketText.includes("phish") || ticketText.includes("suspicious email")) {
      return {
        ticketId: "TICK-DEFAULT",
        category,
        urgency,
        summary: "Phishing email quarantine and security incident reporting.",
        resolutionSteps: [
          "Do not click links or open attachments in the suspicious message.",
          "Click the 'Report Phishing' hook button in the Outlook ribbon to export headers to SOC queue.",
          "If credentials were submitted, disconnect Wi-Fi immediately and call hotline +1-800-555-0911.",
        ],
        citations: ["KB-SEC-006#chunk-0"],
        groundedInRunbooks: true,
      };
    }

    // 10. MFA / Lost Phone / Okta Account Reset (KB-AUTH-002)
    if (
      ticketText.includes("mfa") ||
      ticketText.includes("phone") ||
      ticketText.includes("okta") ||
      ticketText.includes("token") ||
      ticketText.includes("bypass")
    ) {
      return {
        ticketId: "TICK-DEFAULT",
        category,
        urgency,
        summary: "User phone lost; requires supervisor-approved temporary MFA token.",
        resolutionSteps: [
          "Instruct user to call the IT Service Desk voice verification hotline (+1-800-555-0199).",
          "Obtain mandatory two-person supervisor authorization before issuing bypass code.",
          "Generate a temporary 4-hour MFA bypass code in Okta Admin Console.",
        ],
        citations: ["KB-AUTH-002#chunk-0"],
        groundedInRunbooks: true,
      };
    }

    // 11. UNGROUNDED / NO MATCHING RUNBOOK (True Anti-Hallucination Fallback)
    const titleMatch = prompt.userContent.match(/<title>([\s\S]*?)<\/title>/);
    const cleanTitle = titleMatch ? titleMatch[1].trim() : "unsupported issue";

    let fallbackSteps = [
      "Ensure the device is plugged into AC power and attempt a standard restart or recovery boot.",
      "Gather system crash logs or take a photo of any on-screen error dialogue.",
      "Ticket has been escalated to Tier 2 Desktop Engineering queue for hands-on remediation.",
    ];

    if (category === "NETWORK") {
      fallbackSteps = [
        "Toggle device Wi-Fi adapter off and on, or temporarily forget and rejoin the network.",
        "Check proximity to the wireless router or access point to reduce 2.4 GHz / 5 GHz band flapping interference.",
        "Ticket has been escalated to Tier 2 Network Operations queue for channel and access point diagnostics.",
      ];
    } else if (category === "HARDWARE") {
      fallbackSteps = [
        "Inspect physical cables, power connections, and peripheral ports for physical damage.",
        "Perform a full power cycle or EC hardware reset by holding the power button for 15 seconds.",
        "Ticket has been escalated to Tier 2 Hardware Support queue for device inspection or warranty replacement.",
      ];
    } else if (category === "ACCESS_AND_IDENTITY") {
      fallbackSteps = [
        "Verify identity credentials and check corporate authentication status page for service outages.",
        "Contact the IT Service Desk voice verification hotline (+1-800-555-0199) for secure identity confirmation.",
        "Ticket has been escalated to Identity & Access Management (IAM) Tier 2 queue.",
      ];
    }

    return {
      ticketId: "TICK-DEFAULT",
      category,
      urgency,
      summary: `Automated runbook unavailable for "${cleanTitle}". Escalating to human IT Tier 2.`,
      resolutionSteps: fallbackSteps,
      citations: [],
      groundedInRunbooks: false,
    };
  }

  async *streamCopilotResolution(prompt: CopilotPrompt): AsyncIterable<string> {
    const response = await this.generateCopilotResolution(prompt);
    const jsonString =
      typeof response === "string" ? response : JSON.stringify(response);

    // Yield tokens in small slices to simulate real-time streaming deltas
    const chunkSize = 25;
    for (let i = 0; i < jsonString.length; i += chunkSize) {
      yield jsonString.slice(i, i + chunkSize);
    }
  }
}

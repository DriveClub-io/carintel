#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// Configuration
const API_BASE_URL = process.env.CARINTEL_API_URL || "https://jxpbnnmefwtazfvoxvge.supabase.co/functions/v1/vehicles";
const API_KEY = process.env.CARINTEL_API_KEY;

if (!API_KEY) {
  console.error("Error: CARINTEL_API_KEY environment variable is required");
  process.exit(1);
}

// API client helper
async function apiRequest<T>(endpoint: string, params?: Record<string, string | number | undefined>): Promise<T> {
  // Ensure base URL ends with / and endpoint doesn't start with /
  const baseUrl = API_BASE_URL.endsWith("/") ? API_BASE_URL : API_BASE_URL + "/";
  const cleanEndpoint = endpoint.startsWith("/") ? endpoint.slice(1) : endpoint;
  const url = new URL(cleanEndpoint, baseUrl);

  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    });
  }

  const response = await fetch(url.toString(), {
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      "X-Client-Source": "mcp"
    }
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: { message: response.statusText } })) as { error?: { message?: string } };
    throw new Error(errorData.error?.message || `API request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

// Create MCP server
const server = new McpServer({
  name: "carintel",
  version: "0.1.0"
});

// Tool: lookup_vehicle
server.tool(
  "lookup_vehicle",
  "Look up complete vehicle information by year, make, model, and optional trim. Returns specs, warranty, market values, and maintenance schedule.",
  {
    year: z.number().int().min(1900).max(2030).describe("Vehicle model year"),
    make: z.string().describe("Vehicle manufacturer (e.g., Toyota, Honda, Ford)"),
    model: z.string().describe("Vehicle model name (e.g., Camry, Accord, F-150)"),
    trim: z.string().optional().describe("Vehicle trim level (e.g., XLE, Sport, Limited)")
  },
  async ({ year, make, model, trim }) => {
    try {
      const data = await apiRequest<any>("/lookup", { year, make, model, trim });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(data, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error looking up vehicle: ${error instanceof Error ? error.message : "Unknown error"}`
          }
        ],
        isError: true
      };
    }
  }
);

// Tool: decode_vin
server.tool(
  "decode_vin",
  "Decode a VIN (Vehicle Identification Number) to get vehicle information. Returns decoded VIN data plus matching specs, warranty, market values, and maintenance from Car Intel database.",
  {
    vin: z.string().length(17).describe("17-character Vehicle Identification Number")
  },
  async ({ vin }) => {
    try {
      const data = await apiRequest<any>(`/vin/${vin}`);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(data, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error decoding VIN: ${error instanceof Error ? error.message : "Unknown error"}`
          }
        ],
        isError: true
      };
    }
  }
);

// Tool: get_vehicle_specs
server.tool(
  "get_vehicle_specs",
  "Get detailed specifications for a vehicle including engine, transmission, dimensions, fuel economy, and features.",
  {
    year: z.number().int().min(1900).max(2030).describe("Vehicle model year"),
    make: z.string().describe("Vehicle manufacturer"),
    model: z.string().describe("Vehicle model name"),
    trim: z.string().optional().describe("Vehicle trim level")
  },
  async ({ year, make, model, trim }) => {
    try {
      // Use lookup endpoint and extract specs
      const data = await apiRequest<any>("/lookup", { year, make, model, trim });
      const specs = data.data?.specs;
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ data: specs, meta: data.meta }, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting specs: ${error instanceof Error ? error.message : "Unknown error"}`
          }
        ],
        isError: true
      };
    }
  }
);

// Tool: get_market_value
server.tool(
  "get_market_value",
  "Get market value estimates for a vehicle based on condition. Returns trade-in, private party, and dealer retail values.",
  {
    year: z.number().int().min(1900).max(2030).describe("Vehicle model year"),
    make: z.string().describe("Vehicle manufacturer"),
    model: z.string().describe("Vehicle model name"),
    trim: z.string().optional().describe("Vehicle trim level"),
    condition: z.enum(["Outstanding", "Clean", "Average", "Rough"]).optional().describe("Vehicle condition (defaults to all conditions)")
  },
  async ({ year, make, model, trim, condition }) => {
    try {
      // Use lookup endpoint and extract market values
      const data = await apiRequest<any>("/lookup", { year, make, model, trim });
      let marketValues = data.data?.market_values;

      // Filter by condition if specified
      if (condition && marketValues) {
        marketValues = { [condition]: marketValues[condition] };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ data: marketValues, meta: data.meta }, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting market value: ${error instanceof Error ? error.message : "Unknown error"}`
          }
        ],
        isError: true
      };
    }
  }
);

// Tool: get_warranty_info
server.tool(
  "get_warranty_info",
  "Get warranty coverage information for a vehicle including basic, powertrain, corrosion, and roadside assistance coverage.",
  {
    year: z.number().int().min(1900).max(2030).describe("Vehicle model year"),
    make: z.string().describe("Vehicle manufacturer"),
    model: z.string().describe("Vehicle model name"),
    trim: z.string().optional().describe("Vehicle trim level")
  },
  async ({ year, make, model, trim }) => {
    try {
      // Use lookup endpoint and extract warranty
      const data = await apiRequest<any>("/lookup", { year, make, model, trim });
      const warranty = data.data?.warranty;
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ data: warranty, meta: data.meta }, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting warranty info: ${error instanceof Error ? error.message : "Unknown error"}`
          }
        ],
        isError: true
      };
    }
  }
);

// Tool: get_maintenance_schedule
server.tool(
  "get_maintenance_schedule",
  "Get maintenance schedule for a vehicle. Optionally filter by current mileage to show upcoming services.",
  {
    year: z.number().int().min(1900).max(2030).describe("Vehicle model year"),
    make: z.string().describe("Vehicle manufacturer"),
    model: z.string().describe("Vehicle model name"),
    trim: z.string().optional().describe("Vehicle trim level"),
    current_mileage: z.number().int().optional().describe("Current odometer reading to filter upcoming services")
  },
  async ({ year, make, model, trim, current_mileage }) => {
    try {
      // Use lookup endpoint and extract maintenance
      const data = await apiRequest<any>("/lookup", { year, make, model, trim });
      let maintenance = data.data?.maintenance;

      // Filter by current mileage if specified
      if (current_mileage && Array.isArray(maintenance)) {
        maintenance = maintenance.filter((item: any) => item.mileage >= current_mileage);
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ data: maintenance, meta: data.meta }, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting maintenance schedule: ${error instanceof Error ? error.message : "Unknown error"}`
          }
        ],
        isError: true
      };
    }
  }
);

// Tool: list_makes
server.tool(
  "list_makes",
  "Get a list of all vehicle makes (manufacturers) available in the database.",
  {},
  async () => {
    try {
      const data = await apiRequest<any>("/makes");
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(data, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error listing makes: ${error instanceof Error ? error.message : "Unknown error"}`
          }
        ],
        isError: true
      };
    }
  }
);

// Tool: list_models
server.tool(
  "list_models",
  "Get a list of all models for a specific make, optionally filtered by year.",
  {
    make: z.string().describe("Vehicle manufacturer"),
    year: z.number().int().min(1900).max(2030).optional().describe("Filter by model year")
  },
  async ({ make, year }) => {
    try {
      const data = await apiRequest<any>(`/makes/${encodeURIComponent(make)}/models`, { year });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(data, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error listing models: ${error instanceof Error ? error.message : "Unknown error"}`
          }
        ],
        isError: true
      };
    }
  }
);

// Tool: list_trims
server.tool(
  "list_trims",
  "Get a list of all trims for a specific make and model, optionally filtered by year.",
  {
    make: z.string().describe("Vehicle manufacturer"),
    model: z.string().describe("Vehicle model name"),
    year: z.number().int().min(1900).max(2030).optional().describe("Filter by model year")
  },
  async ({ make, model, year }) => {
    try {
      const data = await apiRequest<any>(`/makes/${encodeURIComponent(make)}/models/${encodeURIComponent(model)}/trims`, { year });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(data, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error listing trims: ${error instanceof Error ? error.message : "Unknown error"}`
          }
        ],
        isError: true
      };
    }
  }
);

// Tool: list_years
server.tool(
  "list_years",
  "Get a list of all years available for a specific make and optionally model.",
  {
    make: z.string().describe("Vehicle manufacturer"),
    model: z.string().optional().describe("Vehicle model name")
  },
  async ({ make, model }) => {
    try {
      const endpoint = model
        ? `/makes/${encodeURIComponent(make)}/models/${encodeURIComponent(model)}/years`
        : `/makes/${encodeURIComponent(make)}/years`;
      const data = await apiRequest<any>(endpoint);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(data, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error listing years: ${error instanceof Error ? error.message : "Unknown error"}`
          }
        ],
        isError: true
      };
    }
  }
);

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Car Intel MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

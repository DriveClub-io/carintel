# @carintel/mcp

Car Intel MCP Server - Vehicle intelligence data for AI assistants (Claude, Cursor, etc.)

## Features

- **VIN Decoding** - Decode any VIN to get full vehicle information
- **Vehicle Lookup** - Look up vehicles by year, make, model, and trim
- **Market Values** - Get trade-in, private party, and dealer retail values
- **Warranty Info** - Coverage details for basic, powertrain, corrosion, roadside
- **Maintenance Schedules** - Service intervals from 0 to 150,000+ miles
- **Make/Model/Trim Lists** - Browse available vehicles in the database

## Installation

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "carintel": {
      "command": "npx",
      "args": ["-y", "@carintel/mcp"],
      "env": {
        "CARINTEL_API_KEY": "ci_live_xxxxxxxxxxxxx"
      }
    }
  }
}
```

### Cursor

Add to your Cursor MCP settings:

```json
{
  "carintel": {
    "command": "npx",
    "args": ["-y", "@carintel/mcp"],
    "env": {
      "CARINTEL_API_KEY": "ci_live_xxxxxxxxxxxxx"
    }
  }
}
```

### Manual Installation

```bash
npm install -g @carintel/mcp
```

Then run:

```bash
CARINTEL_API_KEY=ci_live_xxxxx carintel-mcp
```

## Available Tools

### decode_vin

Decode a VIN to get complete vehicle information.

```
Input: { vin: "1HGBH41JXMN109186" }
Output: VIN info, specs, warranty, market values, maintenance schedule
```

### lookup_vehicle

Look up a vehicle by year, make, model, and optional trim.

```
Input: { year: 2024, make: "Toyota", model: "Camry", trim: "XSE" }
Output: Complete vehicle data including specs, warranty, values, maintenance
```

### get_vehicle_specs

Get detailed specifications for a vehicle.

```
Input: { year: 2024, make: "Honda", model: "Accord" }
Output: Engine, transmission, dimensions, fuel economy, features
```

### get_market_value

Get market value estimates by condition.

```
Input: { year: 2022, make: "Ford", model: "F-150", condition: "Clean" }
Output: Trade-in, private party, and dealer retail values
```

### get_warranty_info

Get warranty coverage information.

```
Input: { year: 2024, make: "Kia", model: "Carnival" }
Output: Basic, powertrain, corrosion, roadside coverage (months/miles)
```

### get_maintenance_schedule

Get maintenance schedule, optionally filtered by current mileage.

```
Input: { year: 2024, make: "Toyota", model: "Camry", current_mileage: 45000 }
Output: Upcoming and past service intervals with service items
```

### list_makes

Get all available vehicle makes.

```
Input: {}
Output: ["Acura", "Audi", "BMW", "Chevrolet", ...]
```

### list_models

Get all models for a make, optionally filtered by year.

```
Input: { make: "Toyota", year: 2024 }
Output: ["4Runner", "Camry", "Corolla", "RAV4", ...]
```

### list_trims

Get all trims for a make/model.

```
Input: { make: "Honda", model: "Civic", year: 2024 }
Output: ["EX", "LX", "Sport", "Touring", ...]
```

### list_years

Get available years for a make/model.

```
Input: { make: "Ford", model: "Mustang" }
Output: [2024, 2023, 2022, 2021, ...]
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CARINTEL_API_KEY` | Yes | Your Car Intel API key |
| `CARINTEL_API_URL` | No | Custom API URL (for development) |

## Getting an API Key

Visit [carintel.io](https://carintel.io) to sign up and get your API key.

## Example Conversations

**User:** "What's the value of a 2022 Honda Accord in clean condition?"

**Claude:** *Uses get_market_value tool*
> Based on the Car Intel data, a 2022 Honda Accord in Clean condition is valued at:
> - Trade-in: $24,500
> - Private Party: $26,200
> - Dealer Retail: $28,400

**User:** "Decode this VIN: KNDNE5H36R6364579"

**Claude:** *Uses decode_vin tool*
> This is a 2024 Kia Carnival SX Prestige minivan with a 3.5L V6 engine...

## License

MIT

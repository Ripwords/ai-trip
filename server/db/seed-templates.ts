import { db } from "./index"
import { packingTemplates } from "./schema"

const templates = [
  {
    name: "Beach Trip",
    description: "Essentials for a beach vacation",
    isGlobal: true,
    items: [
      { text: "Swimsuit", category: "Clothes" },
      { text: "Shorts", category: "Clothes" },
      { text: "T-shirts", category: "Clothes" },
      { text: "Sandals", category: "Clothes" },
      { text: "Sunglasses", category: "Accessories" },
      { text: "Sun hat", category: "Accessories" },
      { text: "Sunscreen", category: "Toiletries" },
      { text: "Aloe vera gel", category: "Toiletries" },
      { text: "Toothbrush & toothpaste", category: "Toiletries" },
      { text: "Beach towel", category: "Beach Essentials" },
      { text: "Waterproof phone pouch", category: "Beach Essentials" },
      { text: "Snorkel gear", category: "Beach Essentials" },
      { text: "Phone charger", category: "Electronics" },
      { text: "Power bank", category: "Electronics" },
      { text: "Passport", category: "Documents" },
      { text: "Travel insurance", category: "Documents" },
    ],
  },
  {
    name: "Business Trip",
    description: "Professional travel essentials",
    isGlobal: true,
    items: [
      { text: "Business suits", category: "Clothes" },
      { text: "Dress shoes", category: "Clothes" },
      { text: "Dress shirts", category: "Clothes" },
      { text: "Ties", category: "Clothes" },
      { text: "Casual outfit", category: "Clothes" },
      { text: "Toiletry kit", category: "Toiletries" },
      { text: "Deodorant", category: "Toiletries" },
      { text: "Laptop & charger", category: "Work Items" },
      { text: "Business cards", category: "Work Items" },
      { text: "Notebook & pen", category: "Work Items" },
      { text: "USB drive", category: "Work Items" },
      { text: "Phone charger", category: "Electronics" },
      { text: "Travel adapter", category: "Electronics" },
      { text: "Noise-canceling headphones", category: "Electronics" },
      { text: "Passport / ID", category: "Documents" },
      { text: "Boarding pass", category: "Documents" },
    ],
  },
  {
    name: "Hiking Trip",
    description: "Gear and supplies for hiking adventures",
    isGlobal: true,
    items: [
      { text: "Hiking boots", category: "Clothes" },
      { text: "Moisture-wicking shirts", category: "Clothes" },
      { text: "Hiking pants", category: "Clothes" },
      { text: "Rain jacket", category: "Clothes" },
      { text: "Warm fleece", category: "Clothes" },
      { text: "Hiking socks", category: "Clothes" },
      { text: "Backpack", category: "Gear" },
      { text: "Trekking poles", category: "Gear" },
      { text: "Headlamp", category: "Gear" },
      { text: "Map / compass", category: "Gear" },
      { text: "Water bottles", category: "Food & Water" },
      { text: "Trail snacks", category: "Food & Water" },
      { text: "Water purification tablets", category: "Food & Water" },
      { text: "First aid kit", category: "Safety" },
      { text: "Sunscreen", category: "Safety" },
      { text: "Bug spray", category: "Safety" },
      { text: "Phone + power bank", category: "Electronics" },
    ],
  },
  {
    name: "City Break",
    description: "Light packing for a quick city getaway",
    isGlobal: true,
    items: [
      { text: "Comfortable walking shoes", category: "Clothes" },
      { text: "Casual outfits (2-3)", category: "Clothes" },
      { text: "Light jacket", category: "Clothes" },
      { text: "Evening outfit", category: "Clothes" },
      { text: "Toiletry bag", category: "Toiletries" },
      { text: "Phone & charger", category: "Electronics" },
      { text: "Camera", category: "Electronics" },
      { text: "Travel adapter", category: "Electronics" },
      { text: "Passport / ID", category: "Documents" },
      { text: "Hotel confirmation", category: "Documents" },
      { text: "Day bag / crossbody", category: "Accessories" },
      { text: "Sunglasses", category: "Accessories" },
      { text: "Umbrella", category: "Accessories" },
    ],
  },
  {
    name: "Winter Trip",
    description: "Cold weather travel essentials",
    isGlobal: true,
    items: [
      { text: "Thermal underwear", category: "Clothes" },
      { text: "Sweaters", category: "Clothes" },
      { text: "Warm pants", category: "Clothes" },
      { text: "Wool socks", category: "Clothes" },
      { text: "Winter coat", category: "Outerwear" },
      { text: "Waterproof boots", category: "Outerwear" },
      { text: "Gloves", category: "Accessories" },
      { text: "Scarf", category: "Accessories" },
      { text: "Beanie / warm hat", category: "Accessories" },
      { text: "Lip balm", category: "Toiletries" },
      { text: "Moisturizer", category: "Toiletries" },
      { text: "Hand warmers", category: "Accessories" },
      { text: "Phone & charger", category: "Electronics" },
      { text: "Passport / ID", category: "Documents" },
    ],
  },
]

async function seed() {
  console.log("Seeding packing templates...")

  for (const template of templates) {
    await db.insert(packingTemplates).values(template)
  }

  console.log(`Seeded ${templates.length} packing templates.`)
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed failed:", err)
    process.exit(1)
  })

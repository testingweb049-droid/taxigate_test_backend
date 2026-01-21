require("dotenv").config();
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const MODELS_DIR = path.join(__dirname, "../src/models");

const loadModels = () => {
  const modelFiles = fs.readdirSync(MODELS_DIR)
    .filter((file) => file.endsWith(".model.js"));
  
  console.log(`Loading ${modelFiles.length} model(s)...`);
  
  modelFiles.forEach((file) => {
    try {
      require(path.join(MODELS_DIR, file));
      console.log(`  ✓ Loaded: ${file}`);
    } catch (error) {
      console.error(`  ✗ Failed to load ${file}:`, error.message);
      throw error;
    }
  });
  
  console.log(`\nTotal models registered: ${Object.keys(mongoose.models).length}`);
  console.log(`Models: ${Object.keys(mongoose.models).join(", ")}\n`);
};

loadModels();

/** Confirmation Prompt */
const confirmAction = async (message) => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${message} (yes/no): `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "yes");
    });
  });
};

/** Connect to MongoDB */
async function connectDB() {
  if (!process.env.MONGO_URI) {
    console.error("Error: MONGO_URI environment variable is not set");
    process.exit(1);
  }

  try {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("✓ Connected to MongoDB\n");
  } catch (error) {
    console.error("✗ Failed to connect to MongoDB:", error.message);
    throw error;
  }
}

/** Drop conflicting text indexes */
async function dropConflictingTextIndexes(collection) {
  try {
    const indexes = await collection.indexes();
    // Find text indexes (they have _fts key or text fields)
    const textIndexes = indexes.filter(idx => {
      if (!idx.key) return false;
      // Check for _fts (full text search) key
      if (idx.key._fts) return true;
      // Check for any field with "text" value
      return Object.values(idx.key).some(val => val === "text");
    });
    
    if (textIndexes.length > 0) {
      console.log(`    Found ${textIndexes.length} existing text index(es), dropping...`);
      for (const index of textIndexes) {
        try {
          await collection.dropIndex(index.name);
          console.log(`    ✓ Dropped old text index: ${index.name}`);
        } catch (dropError) {
          // Ignore if index doesn't exist or already dropped
          if (!dropError.message.includes("index not found") && 
              !dropError.message.includes("ns not found")) {
            console.log(`    ⚠ Could not drop index ${index.name}: ${dropError.message}`);
          }
        }
      }
    }
  } catch (error) {
    // If collection doesn't exist yet, that's fine
    if (!error.message.includes("does not exist") && 
        !error.message.includes("ns not found")) {
      console.log(`    ⚠ Error checking indexes: ${error.message}`);
    }
  }
}

/** Sync schema & indexes */
async function migrateDB() {
  console.log("Migrating database schemas and indexes...\n");
  
  const models = Object.values(mongoose.models);
  if (models.length === 0) {
    console.error("✗ No models found. Make sure models are loaded before migration.");
    return;
  }

  try {
    for (const model of models) {
      try {
        const collection = mongoose.connection.collections[model.collection.name];
        
        // Drop conflicting text indexes before migration
        if (collection) {
          await dropConflictingTextIndexes(collection);
        }
        
        await model.init();
        console.log(`  ✓ Migrated: ${model.modelName}`);
      } catch (error) {
        // Handle text index conflicts specifically
        if (error.message.includes("equivalent index already exists") && error.message.includes("text")) {
          console.log(`  ⚠ Text index conflict detected for ${model.modelName}, attempting to resolve...`);
          try {
            const collection = mongoose.connection.collections[model.collection.name];
            if (collection) {
              await dropConflictingTextIndexes(collection);
              // Retry migration after dropping old index
              await model.init();
              console.log(`  ✓ Migrated: ${model.modelName} (after resolving index conflict)`);
            } else {
              throw error;
            }
          } catch (retryError) {
            console.error(`  ✗ Failed to migrate ${model.modelName}:`, retryError.message);
            throw retryError;
          }
        } else {
          console.error(`  ✗ Failed to migrate ${model.modelName}:`, error.message);
          throw error;
        }
      }
    }
    console.log("\n✓ Database migration completed successfully");
  } catch (error) {
    console.error("\n✗ Migration failed:", error.message);
    throw error;
  }
}

/** Drop all collections */
async function dropDB() {
  const confirmed = await confirmAction(
    "This will WIPE all collections. Are you sure?"
  );
  if (!confirmed) {
    return false;
  }

  const collections = Object.keys(mongoose.connection.collections);

  for (const name of collections) {
    // eslint-disable-next-line no-await-in-loop
    await mongoose.connection.collections[name].drop().catch((err) => {
      if (err.message !== "ns not found") throw err;
    });
  }

  return true;
}

/** Clear (truncate) specific collections */
async function clearCollections(collectionNames = []) {
  const collections = Object.keys(mongoose.connection.collections);
  const targets =
    collectionNames.length > 0
      ? collections.filter((name) => collectionNames.includes(name))
      : collections;

  if (targets.length === 0) {
    return;
  }

  const confirmed = await confirmAction(
    `This will DELETE all documents from: ${targets.join(", ")}. Continue?`
  );
  if (!confirmed) {
    return;
  }

  for (const name of targets) {
    // eslint-disable-next-line no-await-in-loop
    await mongoose.connection.collections[name].deleteMany({});
  }

}

const printUsage = () => {
  console.log(`Usage: node scripts/dbManager.js <command> [options]

Commands:
  --migrate          Ensure schemas & indexes exist
  --drop             Drop every collection (destructive)
  --reset            Drop then migrate (destructive)
  --clear [names]    Delete all docs from specific collections (comma separated)
                     e.g. --clear bookings,vehicles
  --status           Print connection info & loaded models`);
};

const printStatus = () => {
  const models = Object.keys(mongoose.models);
  const { host, name: dbName } = mongoose.connection;
  console.log(`Connected to ${host}/${dbName}`);
  console.log(`Loaded models: ${models.length ? models.join(", ") : "none"}`);
};

//  MAIN SCRIPT
(async () => {
  try {
    const [, , command, arg] = process.argv;

    // Connect to database first
    await connectDB();

    switch (command) {
      case "--migrate":
        await migrateDB();
        break;
      case "--drop":
        await dropDB();
        break;
      case "--reset": {
        const confirmed = await confirmAction(
          "This will DROP and MIGRATE the database. Are you sure?"
        );
        if (!confirmed) {
          break;
        }
        const dropped = await dropDB();
        if (dropped) {
          await migrateDB();
        }
        break;
      }
      case "--clear": {
        const collections = arg ? arg.split(",").map((c) => c.trim()) : [];
        await clearCollections(collections);
        break;
      }
      case "--status":
        printStatus();
        break;
      default:
        printUsage();
        break;
    }

    await mongoose.connection.close();
    process.exit(0);
  } catch (err) {
    await mongoose.connection.close();
    process.exit(1);
  }
})();

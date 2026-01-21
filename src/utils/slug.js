const slugify = require("slugify");

async function generateUniqueSlug(Model, baseSlug, docId = null) {
  let slug = baseSlug;
  let count = 0;

  while (true) {
    const query = { slug };
    if (docId) query._id = { $ne: docId };
    const existing = await Model.findOne(query);
    if (!existing) break;
    count += 1;
    slug = `${baseSlug}-${count}`;
  }

  return slug;
}

function createSlug(text) {
  return slugify(text, { lower: true, strict: true });
}

module.exports = { createSlug, generateUniqueSlug };

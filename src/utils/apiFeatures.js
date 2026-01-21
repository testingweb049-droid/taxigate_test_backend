class APIFeatures {
  constructor(query, queryString) {
    this.query = query;
    this.queryString = queryString;
    this.pagination = {};
  }

  filter() {
    const queryObj = { ...this.queryString };
    const excludeFields = ["page", "sort_by", "limit", "fields", "q", "search"];
    excludeFields.forEach((el) => delete queryObj[el]);

    const filterConditions = {};
    Object.keys(queryObj).forEach((key) => {
      if (["min_price", "max_price", "price_filter"].includes(key)) return;
      filterConditions[key] = queryObj[key];
    });

    // Price range filters
    if (queryObj.min_price || queryObj.max_price) {
      filterConditions.price = {};
      if (queryObj.min_price) filterConditions.price.$gte = Number(queryObj.min_price);
      if (queryObj.max_price) filterConditions.price.$lte = Number(queryObj.max_price);
    }

    // Price filter for low/high
    if (queryObj.price_filter) {
      if (queryObj.price_filter === "low") filterConditions.price = { $lt: 150 };
      if (queryObj.price_filter === "high") filterConditions.price = { $gte: 150 };
    }

    this.query = this.query.find(filterConditions);

    // Text search
    const searchTerm = queryObj.search || queryObj.q;
    if (searchTerm) this.query = this.query.find({ $text: { $search: searchTerm } });

    return this;
  }

  sort() {
    const { sort_by } = this.queryString;
    const sortOptions = {
      new_arrival: { createdAt: -1 },
      oldest: { createdAt: 1 },
      lowest: { price: 1 },
      highest: { price: -1 },
    };
    this.query = this.query.sort(sortOptions[sort_by] || { createdAt: -1 });
    return this;
  }

  limitFields() {
    if (this.queryString.fields) {
      const fields = this.queryString.fields.split(",").join(" ");
      this.query = this.query.select(fields);
    }
    return this;
  }

  paginate(totalCount = 0) {
    const page = parseInt(this.queryString.page, 10) || 1;
    const limit = parseInt(this.queryString.limit, 10) || 12;
    const skip = (page - 1) * limit;

    this.pagination = {
      total: totalCount,
      page,
      pages: Math.ceil(totalCount / limit),
      limit,
    };

    this.query = this.query.skip(skip).limit(limit);
    return this;
  }
}

module.exports = APIFeatures;

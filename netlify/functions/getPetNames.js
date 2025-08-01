// netlify/functions/getPetNames.js
// This function queries the Neon database for pet names matching a user's input.

const { Pool } = require('pg');

// Create a new Pool instance to manage connections to your Neon database.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Required for connecting to Neon
  }
});

exports.handler = async function(event, context) {
  // Only handle GET requests for security and efficiency
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      body: 'Method Not Allowed',
    };
  }

  // Get the search query from the URL parameters
  const searchQuery = event.queryStringParameters.q;

  // If there's no query, return an empty array.
  if (!searchQuery || searchQuery.length < 2) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([]),
    };
  }

  try {
    // We use a parameterized query to prevent SQL injection.
    // The ILIKE operator performs a case-insensitive search.
    // We select DISTINCT pet names to avoid duplicates in the suggestions list.
    const { rows } = await pool.query(
      'SELECT DISTINCT summary FROM events WHERE summary ILIKE $1 ORDER BY summary ASC LIMIT 10;',
      [`%${searchQuery}%`]
    );

    // Map the database rows to an array of pet names (strings)
    const petNames = rows.map(row => row.summary);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(petNames),
    };

  } catch (error) {
    console.error("Database error in getPetNames:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to fetch pet names' }),
    };
  }
};

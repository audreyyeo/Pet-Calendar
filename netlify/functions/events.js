// netlify/functions/getPetNames.js
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

exports.handler = async function(event, context) {
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      body: 'Method Not Allowed',
    };
  }

  const searchQuery = event.queryStringParameters.q;

  if (!searchQuery || searchQuery.length < 2) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([]),
    };
  }

  try {
    const { rows } = await pool.query(
      'SELECT DISTINCT summary FROM events WHERE summary ILIKE $1 ORDER BY summary ASC LIMIT 10;',
      [`%${searchQuery}%`]
    );

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
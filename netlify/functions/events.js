// netlify/functions/events.js

// Import the node-postgres library, which is the driver for connecting to PostgreSQL.
const { Pool } = require('pg');

// Create a new Pool instance to manage connections to your Neon database.
// It automatically reads the connection details from the DATABASE_URL environment
// variable you set in your Netlify settings.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Required for connecting to Neon
  }
});

// This is the main handler function that Netlify will run when your
// frontend calls `/.netlify/functions/events`.
exports.handler = async function(event, context) {
  // Determine the request method (GET, POST, PUT, DELETE)
  const httpMethod = event.httpMethod;
  // Get any query parameters from the URL (e.g., ?uid=123)
  const params = event.queryStringParameters;

  try {
    // --- HANDLE GET REQUESTS ---
    // This block runs when the app loads to fetch all existing events.
    if (httpMethod === 'GET') {
      const { rows } = await pool.query('SELECT * FROM events ORDER BY dtstart ASC;');
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rows),
      };
    }

    // --- HANDLE POST REQUESTS ---
    // This block runs when you add a new event.
    if (httpMethod === 'POST') {
      const events = JSON.parse(event.body);
      
      // A transaction ensures that if you add a recurring series, either all
      // events are added successfully, or none are. This prevents partial data.
      const client = await pool.connect();
      try {
        await client.query('BEGIN'); // Start transaction
        for (const ev of events) {
          const query = `
            INSERT INTO events (uid, summary, type, dtstart, dtend, description, is_recurring, recurring_days, series_id, recur_until, series_start_date)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11);
          `;
          // Using parameterized queries ($1, $2, etc.) is a security best practice
          // to prevent SQL injection attacks.
          const values = [
            ev.uid,
            ev.summary,
            ev.type,
            ev.dtstart,
            ev.dtend,
            ev.description || null,
            ev.isRecurring || false,
            ev.recurringDays ? JSON.stringify(ev.recurringDays) : null,
            ev.seriesId || null,
            ev.recurUntil || null,
            ev.seriesStartDate || null
          ];
          await client.query(query, values);
        }
        await client.query('COMMIT'); // Finalize transaction
        return {
          statusCode: 201, // 201 means "Created"
          body: JSON.stringify({ message: 'Events added successfully' }),
        };
      } catch (e) {
        await client.query('ROLLBACK'); // Undo transaction on error
        throw e;
      } finally {
        client.release(); // Release the client back to the pool
      }
    }

    // --- HANDLE PUT REQUESTS ---
    // This block runs when you edit an existing event.
    if (httpMethod === 'PUT') {
        const eventData = JSON.parse(event.body);
        
        if (params.uid) {
            const query = `
                UPDATE events 
                SET summary = $1, type = $2, dtstart = $3, dtend = $4, description = $5, is_recurring = $6, recurring_days = $7, series_id = $8, recur_until = $9, series_start_date = $10
                WHERE uid = $11;
            `;
            const values = [
                eventData.summary,
                eventData.type,
                eventData.dtstart,
                eventData.dtend,
                eventData.description || null,
                eventData.isRecurring || false,
                eventData.recurringDays ? JSON.stringify(eventData.recurringDays) : null,
                eventData.seriesId || null,
                eventData.recurUntil || null,
                eventData.seriesStartDate || null,
                params.uid
            ];
            await pool.query(query, values);
            return {
                statusCode: 200,
                body: JSON.stringify({ message: 'Event updated successfully' }),
            };
        }
    }

    // --- HANDLE DELETE REQUESTS ---
    // This block runs when you remove an event or a series.
    if (httpMethod === 'DELETE') {
      // Delete a single event
      if (params.uid) {
        await pool.query('DELETE FROM events WHERE uid = $1;', [params.uid]);
        return {
          statusCode: 200,
          body: JSON.stringify({ message: `Event ${params.uid} deleted.` }),
        };
      }
      // Delete an entire recurring series
      if (params.seriesId) {
        await pool.query('DELETE FROM events WHERE series_id = $1;', [params.seriesId]);
        return {
          statusCode: 200,
          body: JSON.stringify({ message: `Event series ${params.seriesId} deleted.` }),
        };
      }
    }

    // If the request uses a method not handled above (e.g., PATCH)
    return {
      statusCode: 405,
      body: 'Method Not Allowed',
    };

  } catch (error) {
    // If any error occurs in the `try` block, this will catch it
    // and return a generic server error message.
    console.error(error); // Log the actual error for debugging in Netlify
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal Server Error' }),
    };
  }
};

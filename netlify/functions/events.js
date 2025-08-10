// netlify/functions/events.js

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// --- HELPER FUNCTIONS ---
// These helpers are added to correctly calculate dates on the server,
// mirroring the logic from your frontend code.

/**
 * Formats a Date object into a 'YYYY-MM-DD' string.
 * @param {Date} date The date to format.
 * @returns {string} The formatted date string.
 */
const formatDateToYYYYMMDD = (date) => {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
};

/**
 * Parses a date string and optional time string into a Date object.
 * @param {string} dateString The date string in 'YYYY-MM-DD' format.
 * @param {string} [timeString='00:00'] The time string in 'HH:MM' format.
 * @returns {Date} The parsed Date object.
 */
const parseDateTime = (dateString, timeString = '00:00') => {
    const [year, month, day] = dateString.split('-').map(Number);
    const [hours, minutes] = timeString.split(':').map(Number);
    // Note: The month is 0-indexed in JavaScript's Date constructor.
    return new Date(year, month - 1, day, hours, minutes);
};


// --- MAIN HANDLER ---
exports.handler = async function(event, context) {
  const httpMethod = event.httpMethod;
  const params = event.queryStringParameters;

  try {
    // --- HANDLE GET REQUESTS ---
    if (httpMethod === 'GET') {
      const { rows } = await pool.query('SELECT * FROM events ORDER BY dtstart ASC;');
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rows),
      };
    }

    // --- HANDLE POST REQUESTS ---
    if (httpMethod === 'POST') {
      const events = JSON.parse(event.body);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const ev of events) {
          const query = `
            INSERT INTO events (uid, summary, type, dtstart, dtend, description, is_recurring, recurring_days, series_id, recur_until, series_start_date)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11);
          `;
          const values = [
            ev.uid,
            ev.summary,
            ev.type,
            ev.dtstart,
            ev.dtend,
            ev.description || null,
            ev.is_recurring || false,
            ev.recurring_days ? JSON.stringify(ev.recurring_days) : null,
            ev.series_id || null,
            ev.recur_until || null,
            ev.series_start_date || null
          ];
          await client.query(query, values);
        }
        await client.query('COMMIT');
        return {
          statusCode: 201,
          body: JSON.stringify({ message: 'Events added successfully' }),
        };
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    }

    // --- HANDLE PUT REQUESTS ---
    if (httpMethod === 'PUT') {
        const eventData = JSON.parse(event.body);
        
        // ========================================================================
        // --- FIX: REWRITTEN LOGIC FOR UPDATING AN ENTIRE RECURRING SERIES ---
        // The original code was trying to run a single UPDATE, which is incorrect.
        // The correct logic is to delete the old series and regenerate all events.
        // ========================================================================
        if (params.seriesId) {
            const client = await pool.connect();
            try {
                await client.query('BEGIN'); // Start transaction

                // 1. Delete all old events belonging to this series
                await client.query('DELETE FROM events WHERE series_id = $1;', [params.seriesId]);

                // 2. Regenerate new events based on the updated data from the frontend
                const { summary, time, duration, recurring_days, recur_until, description, type, series_start_date } = eventData;
                let selectedDays = Object.keys(recurring_days).filter(day => recurring_days[day]).map(Number);
                if (selectedDays.length === 0) {
                    selectedDays = [0, 1, 2, 3, 4, 5, 6]; // Default to daily if none are selected
                }
                
                let currentDate = parseDateTime(series_start_date);
                const untilDate = parseDateTime(recur_until);

                while (currentDate <= untilDate) {
                    if (selectedDays.includes(currentDate.getDay())) {
                        const eventStart = parseDateTime(formatDateToYYYYMMDD(currentDate), time);
                        const eventEnd = new Date(eventStart.getTime() + duration * 60000);
                        
                        const insertQuery = `
                            INSERT INTO events (uid, summary, type, dtstart, dtend, description, is_recurring, recurring_days, series_id, recur_until, series_start_date)
                            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11);
                        `;
                        const insertValues = [
                            `manual-${crypto.randomUUID()}`, // Generate a new unique ID for the event instance
                            summary,
                            type,
                            eventStart.toISOString(),
                            eventEnd.toISOString(),
                            description || null,
                            true,
                            JSON.stringify(recurring_days),
                            params.seriesId, // Use the original series ID
                            recur_until,
                            series_start_date
                        ];
                        await client.query(insertQuery, insertValues);
                    }
                    currentDate.setDate(currentDate.getDate() + 1);
                }

                await client.query('COMMIT'); // Finalize transaction
                return {
                    statusCode: 200,
                    body: JSON.stringify({ message: 'Event series updated successfully' }),
                };
            } catch (e) {
                await client.query('ROLLBACK'); // Undo all changes if an error occurs
                throw e; // This will trigger the main catch block below
            } finally {
                client.release(); // Release the client back to the pool
            }
        }
        
        // --- Logic for updating a single event ---
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
                eventData.is_recurring || false,
                eventData.recurring_days ? JSON.stringify(eventData.recurring_days) : null,
                eventData.series_id || null,
                eventData.recur_until || null,
                eventData.series_start_date || null,
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
    if (httpMethod === 'DELETE') {
      if (params.uid) {
        await pool.query('DELETE FROM events WHERE uid = $1;', [params.uid]);
        return {
          statusCode: 200,
          body: JSON.stringify({ message: `Event ${params.uid} deleted.` }),
        };
      }
      if (params.seriesId) {
        await pool.query('DELETE FROM events WHERE series_id = $1;', [params.seriesId]);
        return {
          statusCode: 200,
          body: JSON.stringify({ message: `Event series ${params.seriesId} deleted.` }),
        };
      }
    }

    return {
      statusCode: 405,
      body: 'Method Not Allowed',
    };

  } catch (error) {
    console.error(error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal Server Error' }),
    };
  }
};
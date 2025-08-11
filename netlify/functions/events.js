// netlify/functions/events.js

const { Pool } = require('pg');
const crypto = require('crypto');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

exports.handler = async function(event, context) {
  const httpMethod = event.httpMethod;
  const params = event.queryStringParameters;

  try {
    if (httpMethod === 'GET') {
      const { rows } = await pool.query('SELECT * FROM events ORDER BY dtstart ASC;');
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rows),
      };
    }

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
            ev.uid, ev.summary, ev.type, ev.dtstart, ev.dtend, ev.description || null,
            ev.is_recurring || false, ev.recurring_days ? JSON.stringify(ev.recurring_days) : null,
            ev.series_id || null, ev.recur_until || null, ev.series_start_date || null
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

    if (httpMethod === 'PUT') {
        // Handle updates for an entire series by replacing all events
        if (params.seriesId) {
            const newEvents = JSON.parse(event.body);
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                
                await client.query('DELETE FROM events WHERE series_id = $1;', [params.seriesId]);

                for (const ev of newEvents) {
                     const insertQuery = `
                        INSERT INTO events (uid, summary, type, dtstart, dtend, description, is_recurring, recurring_days, series_id, recur_until, series_start_date)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11);
                    `;
                    const values = [
                        ev.uid, ev.summary, ev.type, ev.dtstart, ev.dtend, ev.description,
                        ev.is_recurring, ev.recurring_days ? JSON.stringify(ev.recurring_days) : null,
                        ev.series_id, ev.recur_until, ev.series_start_date
                    ];
                    await client.query(insertQuery, values);
                }

                await client.query('COMMIT');
                return {
                    statusCode: 200,
                    body: JSON.stringify({ message: 'Event series updated successfully' }),
                };
            } catch(e) {
                await client.query('ROLLBACK');
                throw e;
            } finally {
                client.release();
            }
        }
        
        // Handle updates for a single event
        if (params.uid) {
            const eventData = JSON.parse(event.body);
            const query = `
                UPDATE events 
                SET summary = $1, type = $2, dtstart = $3, dtend = $4, description = $5, is_recurring = $6, recurring_days = $7, series_id = $8, recur_until = $9, series_start_date = $10
                WHERE uid = $11;
            `;
            const values = [
                eventData.summary, eventData.type, eventData.dtstart, eventData.dtend,
                eventData.description || null, eventData.is_recurring || false,
                eventData.recurring_days ? JSON.stringify(eventData.recurring_days) : null,
                eventData.series_id || null, eventData.recur_until || null,
                eventData.series_start_date || null, params.uid
            ];
            await pool.query(query, values);
            return {
                statusCode: 200,
                body: JSON.stringify({ message: 'Event updated successfully' }),
            };
        }
    }

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
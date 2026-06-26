// Replace your current fetch logic with this:
const { data, error } = await supabase
  .from('properties_raw')
  .select('*')
  .neq('source', 'manual_entry'); // This is the filter

if (error) {
  console.error("Fetch error:", error);
  return res.status(500).send("Database Error");
}

res.json(data);

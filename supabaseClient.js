
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://midneoooykeoquxkjkrg.supabase.co';
const supabaseAnonKey = 'sb_publishable_wH2in1zbqd1jNggdbNT5iQ_1BiDXzLd';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

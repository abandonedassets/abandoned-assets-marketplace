useEffect(() => {
    const fetchDeals = async () => {
      setLoading(true);
      // Fetch everything to see what the statuses actually are
      const { data, error } = await supabase
        .from('deals_master')
        .select('address, status');
      
      if (error) {
        console.error("Error:", error);
      } else {
        // Just print everything found
        console.log("Found deals:", data);
        setDeals(data || []);
      }
      setLoading(false);
    };

    fetchDeals();
  }, []);

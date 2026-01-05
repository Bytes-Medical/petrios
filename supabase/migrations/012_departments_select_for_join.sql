-- Allow authenticated users to list departments for join requests
CREATE POLICY "Authenticated users can view departments"
  ON departments FOR SELECT
  USING (auth.uid() IS NOT NULL);

DELETE FROM `integrations`
WHERE `provider` = 'gmail'
  AND lower(`account_email`) = 'sinakashani5@gmail.com';

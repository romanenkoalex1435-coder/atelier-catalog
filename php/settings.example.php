<?php
// Copy to config.local.php on the server. Paths and hostname only; no credentials here.
return [
    'REWEAR_DATA_DIR' => '/absolute/private/rewear-data',
    'REWEAR_DOCROOT' => '/absolute/public_html',
    'REWEAR_SITE_URL' => 'https://rewearvintage.shop',
    'REWEAR_SCRYPT_NODE' => '/usr/bin/node10',
    // Leave empty unless the hosting provider's nginx forwarding behavior was verified.
    'REWEAR_TRUSTED_PROXIES' => '',
];

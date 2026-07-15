package com.henohenon.kotohakobi;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.henohenon.kotohakobi.plugins.HakoBlePlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(HakoBlePlugin.class);
        super.onCreate(savedInstanceState);
    }
}

package com.example.model;

import java.net.URI;
import javax.annotation.Nullable;

@Entity
@Data
public class Address {

    private String street;

    private String city;

    private String state;

    private String postalCode;

    private String country;

    @Nullable
    private String apartment;

    @Nullable
    private URI mapUri;
}

package com.example.dto;

import java.util.List;

/**
 * Generic paginated response wrapper.
 */
public class PagedResult<T> {

    private List<T> content;

    private int totalElements;

    private int totalPages;

    private int page;

    private int size;

    private boolean first;

    private boolean last;
}
